/**
 * Account-linking regression tests against a REAL Better Auth instance (memory
 * adapter) using the exact `account.accountLinking` options `server.ts` ships.
 *
 * The OAuth callback is driven through Better Auth's own `handleOAuthUserInfo`
 * (what genericOAuth and the gate plugin call after the broker hands back a
 * profile), so these cover the library's real linking decision, not a copy of it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { farmAccountLinking, passwordSignUpAllowed } from "./farm-access.ts";

const GATE_PROVIDER_ID = "grok-gate";
const OWNER_EMAIL = "owner@example.com";

type Row = Record<string, unknown>;
type Tables = { user: Row[]; session: Row[]; account: Row[]; verification: Row[] };
type LinkingOptions = ReturnType<typeof farmAccountLinking> | {
  enabled: boolean;
  trustedProviders: string[];
  requireLocalEmailVerified: boolean;
};

/** The pre-fix config: every broker provider trusted, local verification ignored. */
const LEGACY_LINKING: LinkingOptions = {
  enabled: true,
  trustedProviders: ["grok-google", "grok-x", GATE_PROVIDER_ID],
  requireLocalEmailVerified: false,
};

function makeAuth(options: { linking?: LinkingOptions; allowSignUp?: boolean } = {}) {
  const tables: Tables = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: "http://localhost:8080",
    secret: "test-only-secret-test-only-secret-0123456789",
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true, disableSignUp: options.allowSignUp === false },
    account: { accountLinking: options.linking ?? farmAccountLinking([GATE_PROVIDER_ID]) },
    logger: { disabled: true },
  });
  return { auth, tables };
}

type Auth = ReturnType<typeof makeAuth>["auth"];

/** Simulate the broker returning a profile for `providerId` after sign-in. */
async function oauthSignIn(
  auth: Auth,
  profile: { providerId: string; sub: string; email: string; emailVerified: boolean },
) {
  const context = await auth.$context;
  const c = { context } as unknown as Parameters<typeof handleOAuthUserInfo>[0];
  return handleOAuthUserInfo(c, {
    userInfo: {
      id: profile.sub,
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: "Farm Owner",
    },
    account: { providerId: profile.providerId, accountId: profile.sub } as Parameters<
      typeof handleOAuthUserInfo
    >[1]["account"],
  });
}

async function squatWithPassword(auth: Auth, email = OWNER_EMAIL) {
  const res = await auth.api.signUpEmail({
    body: { email, password: "attacker-password-123", name: "Squatter" },
  });
  return res.user;
}

function accountsFor(tables: Tables, userId: string) {
  return tables.account.filter((row) => row.userId === userId).map((row) => row.providerId);
}

describe("Google account linking (hijack regression)", () => {
  it("the old config linked Google into an unverified password account (the bug)", async () => {
    const { auth, tables } = makeAuth({ linking: LEGACY_LINKING });
    const squatter = await squatWithPassword(auth);
    assert.equal(squatter.emailVerified, false);
    const result = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(result.error, null);
    assert.equal(result.data?.user.id, squatter.id, "owner landed in the squatter's account");
    assert.deepEqual(accountsFor(tables, squatter.id).sort(), ["credential", "grok-google"]);
  });

  it("does NOT link a same-email Google sign-in into an unverified local account", async () => {
    const { auth, tables } = makeAuth();
    const squatter = await squatWithPassword(auth);
    const result = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(result.data, null);
    assert.equal(result.error, "account not linked");
    assert.deepEqual(accountsFor(tables, squatter.id), ["credential"]);
    assert.equal(tables.session.filter((s) => s.userId === squatter.id).length, 1, "only the squatter's own sign-up session");
    const stored = tables.user.find((u) => u.id === squatter.id);
    assert.equal(stored?.emailVerified, false, "Google must not mark the squatter verified");
  });

  it("links a same-email Google sign-in into a VERIFIED local account", async () => {
    const { auth, tables } = makeAuth();
    const local = await squatWithPassword(auth);
    const row = tables.user.find((u) => u.id === local.id);
    assert.ok(row);
    row.emailVerified = true; // e.g. confirmed through an email link
    const result = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(result.error, null);
    assert.equal(result.data?.user.id, local.id);
    assert.deepEqual(accountsFor(tables, local.id).sort(), ["credential", "grok-google"]);
  });

  it("creates a fresh, verified user for a first-time Google sign-in", async () => {
    const { auth, tables } = makeAuth();
    const result = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(result.error, null);
    assert.equal(result.isRegister, true);
    assert.equal(result.data?.user.emailVerified, true);
    assert.deepEqual(accountsFor(tables, String(result.data?.user.id)), ["grok-google"]);
  });

  it("signs a returning Google user back into the same account", async () => {
    const { auth } = makeAuth();
    const first = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    const again = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(again.error, null);
    assert.equal(again.data?.user.id, first.data?.user.id);
  });

  it("does not let an unverified X email join an existing verified account", async () => {
    const { auth, tables } = makeAuth();
    const google = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    const userId = String(google.data?.user.id);
    const x = await oauthSignIn(auth, {
      providerId: "grok-x",
      sub: "x-someone",
      email: OWNER_EMAIL,
      emailVerified: false,
    });
    assert.equal(x.data, null);
    assert.equal(x.error, "account not linked");
    assert.deepEqual(accountsFor(tables, userId), ["grok-google"]);
  });

  it("does not link even a trusted gate identity into an unverified local account", async () => {
    const { auth, tables } = makeAuth();
    const squatter = await squatWithPassword(auth);
    const gate = await oauthSignIn(auth, {
      providerId: GATE_PROVIDER_ID,
      sub: "gate-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(gate.error, "account not linked");
    assert.deepEqual(accountsFor(tables, squatter.id), ["credential"]);
  });
});

describe("email/password sign-up on a deployed store", () => {
  it("is refused when the store is deployed, so nobody can pre-register an address", async () => {
    const deployed = { DATABASE_URL: "postgres://example/db" };
    assert.equal(passwordSignUpAllowed(deployed), false);
    const { auth, tables } = makeAuth({ allowSignUp: passwordSignUpAllowed(deployed) });
    await assert.rejects(() => squatWithPassword(auth));
    assert.equal(tables.user.length, 0);
    // The owner's Google sign-in then creates their own, verified account.
    const result = await oauthSignIn(auth, {
      providerId: "grok-google",
      sub: "google-owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(result.error, null);
    assert.equal(result.data?.user.emailVerified, true);
  });

  it("still works in local dev and the throwaway preview", async () => {
    assert.equal(passwordSignUpAllowed({}), true);
    const { auth } = makeAuth({ allowSignUp: passwordSignUpAllowed({}) });
    const user = await squatWithPassword(auth, "dev@example.com");
    assert.equal(user.email, "dev@example.com");
  });
});
