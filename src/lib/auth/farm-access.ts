/**
 * Who may sign in, link identities, and run the farm desk (server-only rules).
 *
 * Kept dependency-free so `server.ts`, `shop.functions.ts` and the node tests
 * all apply the exact same policy.
 *
 * Two risks this closes:
 *
 * 1. **Google/X account hijack.** Better Auth links a new OAuth identity into
 *    an existing user that has the same email. With
 *    `requireLocalEmailVerified: false` that included users whose email nobody
 *    ever confirmed, so a stranger could register `owner@gmail.com` with their
 *    own password and the real owner's later "Continue with Google" would land
 *    in the stranger's account (and the stranger's password kept working).
 *    Now an identity only links into a user whose email is verified, and only
 *    Google (plus the platform gate) is trusted to vouch for its email. X
 *    emails are synthetic and never verified, so X is no longer trusted.
 *    Deployed stores also refuse new email/password sign-ups, so nobody can
 *    pre-register an address at all.
 *
 * 2. **Admin desk takeover.** The desk used to belong to whichever signed-in
 *    account clicked "This is my farm desk" first. Now a claim needs a
 *    verified email on the `FARM_OWNER_EMAILS` allowlist. On a deployed store
 *    with no allowlist, claiming is refused outright.
 */

/** Read-only environment shape (`process.env` or a test fake). */
export type EnvLike = Readonly<Record<string, string | undefined>>;

function read(env: EnvLike, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** Comma/space/semicolon separated list of emails allowed to claim the desk. */
export const OWNER_EMAILS_ENV = "FARM_OWNER_EMAILS";

/**
 * True for a deployed store (real database, published project, or a production
 * server build). Local `npm run dev`, the sandbox live preview and the tests
 * are not deployed: they run on the throwaway in-memory PGLite database.
 */
export function isDeployedStore(env: EnvLike): boolean {
  return Boolean(
    read(env, "DATABASE_URL") ||
      read(env, "GROK_PROJECT_ID") ||
      read(env, "NODE_ENV") === "production",
  );
}

/**
 * New email/password accounts are only allowed off-deploy. The app has no
 * mailer, so a deployed sign-up could never be verified, and an unverified
 * account only exists to squat an address. The desk owner signs in with Google.
 */
export function passwordSignUpAllowed(env: EnvLike): boolean {
  return !isDeployedStore(env);
}

/** Parse `FARM_OWNER_EMAILS` into lower-cased, de-duplicated addresses. */
export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (email.includes("@")) out.add(email);
  }
  return [...out];
}

/**
 * Providers whose email Better Auth may treat as proven when linking: Google
 * (via the Grok broker) verifies the address before it hands it over. X is
 * deliberately absent: its emails are synthetic placeholders.
 */
export const VERIFIED_EMAIL_PROVIDERS: readonly string[] = ["grok-google"];

/**
 * Better Auth `account.accountLinking` options.
 *
 * - `requireLocalEmailVerified: true` (the Better Auth default, previously
 *   turned off) means an OAuth sign-in only joins an existing same-email user
 *   when that user's email is verified. An unverified password account gets
 *   `account_not_linked` instead of silently absorbing the Google identity.
 * - `trustedProviders` lists only providers whose emails are verified, plus
 *   any platform identity passed in (the Grok gate).
 */
export function farmAccountLinking(extraTrustedProviders: readonly string[] = []) {
  return {
    enabled: true,
    trustedProviders: [...VERIFIED_EMAIL_PROVIDERS, ...extraTrustedProviders],
    requireLocalEmailVerified: true,
  };
}

/** The signed-in user's identity as read from the auth tables. */
export type DeskIdentity = {
  email: string | null;
  emailVerified: boolean;
  /** Provider ids of the user's linked accounts (e.g. "grok-google", "credential"). */
  providerIds: readonly string[];
};

/**
 * A desk identity's email counts as verified when Better Auth marked it so, or
 * when the user signs in through Google. Linking now requires a verified local
 * email, so a Google-linked user's email is always Google's own or a verified one.
 */
export function hasVerifiedEmail(identity: DeskIdentity | null): boolean {
  if (!identity?.email) return false;
  if (identity.emailVerified) return true;
  return identity.providerIds.some((id) => VERIFIED_EMAIL_PROVIDERS.includes(id));
}

export type DeskRefusal = "not-configured" | "unverified" | "not-allowed";

export type DeskAccess =
  | { status: "owner" }
  | { status: "denied" }
  | { status: "claimable" }
  | { status: "refused"; reason: DeskRefusal };

export type DeskAccessInput = {
  userId: string;
  /** Current `shop_owner.user_id`, or null when nobody has claimed the desk. */
  ownerUserId: string | null;
  identity: DeskIdentity | null;
  ownerEmails: readonly string[];
  /** Deployed store: refuse every claim when no allowlist is configured. */
  enforce: boolean;
};

/**
 * Decide what this signed-in user may do at the farm desk.
 *
 * - The desk already has an owner: that user is "owner", everyone else "denied".
 * - No owner and an allowlist is set: only a verified, allow-listed email may claim.
 * - No owner and no allowlist: refused on a deployed store; local dev and tests
 *   keep the old first-claim behavior (their database is throwaway).
 */
export function deskAccess(input: DeskAccessInput): DeskAccess {
  const { userId, ownerUserId, identity, ownerEmails, enforce } = input;
  if (ownerUserId) return ownerUserId === userId ? { status: "owner" } : { status: "denied" };
  if (ownerEmails.length === 0) {
    return enforce ? { status: "refused", reason: "not-configured" } : { status: "claimable" };
  }
  if (!hasVerifiedEmail(identity)) return { status: "refused", reason: "unverified" };
  const email = (identity?.email ?? "").trim().toLowerCase();
  if (!ownerEmails.includes(email)) return { status: "refused", reason: "not-allowed" };
  return { status: "claimable" };
}

/** Shopper-facing text for each refusal (no account details leak). */
export function deskRefusalMessage(reason: DeskRefusal): string {
  switch (reason) {
    case "not-configured":
      return "The farm desk has no owner list yet. Set FARM_OWNER_EMAILS on the server, then sign in with that Google account.";
    case "unverified":
      return "Sign in with the farm's Google account to claim the desk. This login's email is not verified.";
    case "not-allowed":
      return "This account is not on the farm's owner list, so it cannot claim the desk.";
  }
}

/** Read the allowlist + enforcement flag from an environment. */
export function deskPolicyFromEnv(env: EnvLike): { ownerEmails: string[]; enforce: boolean } {
  return { ownerEmails: parseOwnerEmails(read(env, OWNER_EMAILS_ENV)), enforce: isDeployedStore(env) };
}
