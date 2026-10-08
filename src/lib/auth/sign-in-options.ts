/**
 * Which "Continue with …" sign-in methods this deployment can actually finish.
 *
 * Dependency-free (no Better Auth, no `pg`) so `server.ts`, the
 * `getSignInOptions` server function and the node tests share one answer.
 *
 * - **Google, directly** (`providerId: "google"`): the farm's own Google Cloud
 *   OAuth client, from `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Only offered
 *   when BOTH are set. Google redirects back to
 *   `<BETTER_AUTH_URL>/api/auth/callback/google`, which must be listed on the
 *   Google client. When it is configured it replaces the broker's Google.
 * - **Grok auth broker** (`grok-google`, `grok-x`): only usable with a per-app
 *   broker client (`GROK_AUTH_CLIENT_ID` + `GROK_AUTH_CLIENT_SECRET`), or in the
 *   sandbox live preview, which has no fixed `BETTER_AUTH_URL` and falls back to
 *   the shared preview client. A deployed store on its own domain without a
 *   per-app client cannot complete a broker sign-in (the preview client only
 *   returns to `*.grok-sandbox.com`), so those buttons are hidden there.
 */
import { GROK_PROVIDERS, type GrokProvider } from "./providers.ts";

export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Better Auth's id for its built-in Google provider (also the callback path segment). */
export const GOOGLE_PROVIDER_ID = "google";

/** A sign-in button the login page should render. */
export type SignInOption = {
  /** Better Auth provider id. */
  id: string;
  label: string;
  /** `social`: Better Auth built-in provider (`signIn.social`). `broker`: genericOAuth via the Grok broker. */
  kind: "social" | "broker";
};

function read(env: EnvLike, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function authDisabled(env: EnvLike): boolean {
  return read(env, "VITE_AUTH_ENABLED") === "false";
}

/** The farm's own Google OAuth client, or null unless BOTH id and secret are set. */
export function googleOAuthCredentials(
  env: EnvLike,
): { clientId: string; clientSecret: string } | null {
  if (authDisabled(env)) return null;
  const clientId = read(env, "GOOGLE_CLIENT_ID");
  const clientSecret = read(env, "GOOGLE_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Better Auth `socialProviders` for this environment: Google with the farm's
 * own client when configured, otherwise none. `server.ts` spreads this in and
 * the tests build a real Better Auth instance from the same value.
 */
export function farmSocialProviders(env: EnvLike) {
  const google = googleOAuthCredentials(env);
  if (!google) return {};
  return {
    google: {
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      // Always show Google's account chooser so the owner can pick the farm account.
      prompt: "select_account" as const,
    },
  };
}

/** True when a Grok broker sign-in can complete in this environment (see file header). */
export function brokerSignInUsable(env: EnvLike): boolean {
  if (authDisabled(env)) return false;
  const perAppClient = Boolean(read(env, "GROK_AUTH_CLIENT_ID") && read(env, "GROK_AUTH_CLIENT_SECRET"));
  return perAppClient || !read(env, "BETTER_AUTH_URL");
}

/**
 * Broker providers to register and show. The broker's Google is dropped when
 * Google is configured directly, so there is one Google button and one Google
 * identity per person.
 */
export function brokerProvidersFor(env: EnvLike): GrokProvider[] {
  if (!brokerSignInUsable(env)) return [];
  const directGoogle = googleOAuthCredentials(env) !== null;
  return GROK_PROVIDERS.filter((p) => !(directGoogle && p.idp === "google"));
}

/** Every sign-in button for this environment, direct Google first. */
export function signInOptions(env: EnvLike): SignInOption[] {
  const options: SignInOption[] = [];
  if (googleOAuthCredentials(env)) options.push({ id: GOOGLE_PROVIDER_ID, label: "Google", kind: "social" });
  for (const p of brokerProvidersFor(env)) options.push({ id: p.providerId, label: p.label, kind: "broker" });
  return options;
}
