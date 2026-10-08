/**
 * Direct Google sign-in (the farm's own Google Cloud OAuth client).
 *
 * - Which sign-in buttons each environment offers (`sign-in-options.ts`).
 * - A REAL Better Auth instance built from the same `socialProviders` and
 *   `account.accountLinking` values `server.ts` ships: the Google authorize URL
 *   it produces, and how Google identities link (driven through Better Auth's
 *   own `handleOAuthUserInfo`, as its Google callback does).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { farmAccountLinking, hasVerifiedEmail, passwordSignUpAllowed } from "./farm-access.ts";
import {
  GOOGLE_PROVIDER_ID,
  brokerProvidersFor,
  brokerSignInUsable,
  farmSocialProviders,
  googleOAuthCredentials,
  signInOptions,
} from "./sign-in-options.ts";

const DEV_URL = "https://dev.hoggsheaven.farm";
const GOOGLE = { GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret" };
/** The dev site: deployed, own domain, no per-app broker client. */
const DEV_SITE = { DATABASE_URL: "postgres://deployed/db", NODE_ENV: "production", BETTER_AUTH_URL: DEV_URL };
const OWNER = "chuckhogg@gmail.com";

describe("sign-in options per environment", () => {
  it("offers Google only when BOTH the client id and secret are set", () => {
    assert.equal(googleOAuthCredentials({}), null);
    assert.equal(googleOAuthCredentials({ GOOGLE_CLIENT_ID: GOOGLE.GOOGLE_CLIENT_ID }), null);
    assert.equal(googleOAuthCredentials({ GOOGLE_CLIENT_SECRET: "s" }), null);
    assert.equal(googleOAuthCredentials({ GOOGLE_CLIENT_ID: "  ", GOOGLE_CLIENT_SECRET: "s" }), null);
    assert.deepEqual(googleOAuthCredentials(GOOGLE), {
      clientId: GOOGLE.GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE.GOOGLE_CLIENT_SECRET,
    });
    assert.deepEqual(farmSocialProviders({ GOOGLE_CLIENT_ID: "only-id" }), {});
  });

  it("the deployed dev site shows only Google once it is configured", () => {
    assert.deepEqual(signInOptions({ ...DEV_SITE, ...GOOGLE }), [
      { id: GOOGLE_PROVIDER_ID, label: "Google", kind: "social" },
    ]);
  });

  it("the deployed dev site shows no provider buttons before Google is configured", () => {
    // The shared preview broker client cannot return to dev.hoggsheaven.farm.
    assert.equal(brokerSignInUsable(DEV_SITE), false);
    assert.deepEqual(signInOptions(DEV_SITE), []);
  });

  it("a per-app broker client keeps X, but Google stays direct (no duplicate Google)", () => {
    const env = { ...DEV_SITE, ...GOOGLE, GROK_AUTH_CLIENT_ID: "app", GROK_AUTH_CLIENT_SECRET: "app-secret" };
    assert.deepEqual(brokerProvidersFor(env).map((p) => p.providerId), ["grok-x"]);
    assert.deepEqual(signInOptions(env).map((o) => o.id), ["google", "grok-x"]);
  });

  it("the sandbox preview (no BETTER_AUTH_URL) keeps the broker buttons as before", () => {
    assert.deepEqual(signInOptions({}).map((o) => o.id), ["grok-google", "grok-x"]);
  });

  it("VITE_AUTH_ENABLED=false turns every provider off", () => {
    assert.deepEqual(signInOptions({ ...GOOGLE, VITE_AUTH_ENABLED: "false" }), []);
    assert.deepEqual(farmSocialProviders({ ...GOOGLE, VITE_AUTH_ENABLED: "false" }), {});
  });

  it("never returns credentials to the browser", () => {
    const json = JSON.stringify(signInOptions({ ...DEV_SITE, ...GOOGLE }));
    assert.equal(json.includes(GOOGLE.GOOGLE_CLIENT_ID), false);
    assert.equal(json.includes(GOOGLE.GOOGLE_CLIENT_SECRET), false);
  });
});

type Row = Record<string, unknown>;
type Tables = { user: Row[]; session: Row[]; account: Row[]; verification: Row[] };

function makeAuth(env: Record<string, string> = { ...DEV_SITE, ...GOOGLE }) {
  const tables: Tables = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: DEV_URL,
    secret: "test-only-secret-test-only-secret-0123456789",
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true, disableSignUp: !passwordSignUpAllowed(env) },
    socialProviders: farmSocialProviders(env),
    account: { accountLinking: farmAccountLinking(["grok-gate"]) },
    logger: { disabled: true },
  });
  return { auth, tables };
}

type Auth = ReturnType<typeof makeAuth>["auth"];

/** What Better Auth's Google callback does with Google's userinfo. */
async function googleSignIn(auth: Auth, profile: { sub: string; email: string; emailVerified: boolean }) {
  const context = await auth.$context;
  const c = { context } as unknown as Parameters<typeof handleOAuthUserInfo>[0];
  return handleOAuthUserInfo(c, {
    userInfo: { id: profile.sub, email: profile.email, emailVerified: profile.emailVerified, name: "Chuck" },
    account: { providerId: GOOGLE_PROVIDER_ID, accountId: profile.sub } as Parameters<
      typeof handleOAuthUserInfo
    >[1]["account"],
  });
}

function accountsFor(tables: Tables, userId: string) {
  return tables.account.filter((row) => row.userId === userId).map((row) => String(row.providerId));
}

describe("Better Auth with the farm's Google client", () => {
  it("sign-in/social sends the browser to Google with this client and the dev callback", async () => {
    const { auth } = makeAuth();
    const res = await auth.api.signInSocial({ body: { provider: "google", callbackURL: "/admin" } });
    assert.ok(res && "url" in res && res.url, "expected an authorize URL");
    const url = new URL(String(res.url));
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("client_id"), GOOGLE.GOOGLE_CLIENT_ID);
    assert.equal(url.searchParams.get("redirect_uri"), `${DEV_URL}/api/auth/callback/google`);
    assert.equal(url.searchParams.get("prompt"), "select_account");
    assert.match(url.searchParams.get("scope") ?? "", /\bemail\b/);
    assert.ok(url.searchParams.get("state"), "CSRF state is set");
    assert.equal(url.searchParams.get("client_secret"), null, "the secret never goes to the browser");
  });

  it("without Google configured, sign-in/social refuses the google provider", async () => {
    const { auth } = makeAuth(DEV_SITE);
    await assert.rejects(() => auth.api.signInSocial({ body: { provider: "google", callbackURL: "/admin" } }));
  });

  it("a first Google sign-in with a Google-verified email creates a verified user who can claim the desk", async () => {
    const { auth, tables } = makeAuth();
    const result = await googleSignIn(auth, { sub: "g-chuck", email: OWNER, emailVerified: true });
    assert.equal(result.error, null);
    assert.equal(result.data?.user.emailVerified, true);
    const userId = String(result.data?.user.id);
    assert.deepEqual(accountsFor(tables, userId), ["google"]);
    assert.equal(
      hasVerifiedEmail({ email: OWNER, emailVerified: true, providerIds: accountsFor(tables, userId) }),
      true,
    );
  });

  it("a Google email that Google itself has not verified stays unverified", async () => {
    const { auth, tables } = makeAuth();
    const result = await googleSignIn(auth, { sub: "g-unverified", email: "someone@example.com", emailVerified: false });
    assert.equal(result.error, null);
    assert.equal(result.data?.user.emailVerified, false);
    const providerIds = accountsFor(tables, String(result.data?.user.id));
    assert.equal(hasVerifiedEmail({ email: "someone@example.com", emailVerified: false, providerIds }), false);
  });

  it("does NOT link Google into an unverified same-email password account", async () => {
    const { auth, tables } = makeAuth({ ...GOOGLE }); // off-deploy, so a password account can exist
    const squatter = (await auth.api.signUpEmail({ body: { email: OWNER, password: "attacker-password-123", name: "Squatter" } })).user;
    const result = await googleSignIn(auth, { sub: "g-chuck", email: OWNER, emailVerified: true });
    assert.equal(result.data, null);
    assert.equal(result.error, "account not linked");
    assert.deepEqual(accountsFor(tables, squatter.id), ["credential"]);
  });

  it("links a Google-verified sign-in into a VERIFIED same-email account", async () => {
    const { auth, tables } = makeAuth({ ...GOOGLE });
    const local = (await auth.api.signUpEmail({ body: { email: OWNER, password: "owner-password-123", name: "Chuck" } })).user;
    const row = tables.user.find((u) => u.id === local.id);
    assert.ok(row);
    row.emailVerified = true;
    const result = await googleSignIn(auth, { sub: "g-chuck", email: OWNER, emailVerified: true });
    assert.equal(result.error, null);
    assert.equal(result.data?.user.id, local.id);
    assert.deepEqual(accountsFor(tables, local.id).sort(), ["credential", "google"]);
  });

  it("does NOT link a Google identity whose email Google has not verified, even into a verified account", async () => {
    const { auth, tables } = makeAuth();
    const owner = await googleSignIn(auth, { sub: "g-chuck", email: OWNER, emailVerified: true });
    const userId = String(owner.data?.user.id);
    const other = await googleSignIn(auth, { sub: "g-other", email: OWNER, emailVerified: false });
    assert.equal(other.data, null);
    assert.equal(other.error, "account not linked");
    assert.deepEqual(accountsFor(tables, userId), ["google"]);
  });

  it("password sign-up stays disabled on the deployed dev site", async () => {
    const { auth, tables } = makeAuth();
    await assert.rejects(() =>
      auth.api.signUpEmail({ body: { email: OWNER, password: "attacker-password-123", name: "Squatter" } }),
    );
    assert.equal(tables.user.length, 0);
  });
});
