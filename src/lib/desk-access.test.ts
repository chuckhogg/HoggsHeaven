/**
 * Farm desk claim rules: pure policy (`auth/farm-access.ts`) plus the real
 * `adminState` / `claimDesk` queries (`desk-access.server.ts`) run against an
 * in-memory PGLite database built from this repo's own migrations.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  deskAccess,
  deskPolicyFromEnv,
  hasVerifiedEmail,
  isDeployedStore,
  parseOwnerEmails,
  type DeskIdentity,
} from "./auth/farm-access.ts";
import { claimDeskFor, deskOwnerId, deskStateFor } from "./desk-access.server.ts";
import type { Sql } from "./db";

const OWNER = "owner@example.com";

const googleOwner: DeskIdentity = { email: OWNER, emailVerified: true, providerIds: ["grok-google"] };
const unverifiedPassword: DeskIdentity = { email: OWNER, emailVerified: false, providerIds: ["credential"] };

describe("farm-access policy", () => {
  it("parses FARM_OWNER_EMAILS case-insensitively and ignores junk", () => {
    assert.deepEqual(parseOwnerEmails(" Owner@Example.com, second@example.com;owner@example.com  nope "), [
      "owner@example.com",
      "second@example.com",
    ]);
    assert.deepEqual(parseOwnerEmails(undefined), []);
    assert.deepEqual(parseOwnerEmails("   "), []);
  });

  it("treats a real database, a published project or a production build as deployed", () => {
    assert.equal(isDeployedStore({}), false);
    assert.equal(isDeployedStore({ DATABASE_URL: "  " }), false);
    assert.equal(isDeployedStore({ DATABASE_URL: "postgres://x/y" }), true);
    assert.equal(isDeployedStore({ GROK_PROJECT_ID: "proj-1" }), true);
    assert.equal(isDeployedStore({ NODE_ENV: "production" }), true);
  });

  it("only counts a verified or Google-backed email as verified", () => {
    assert.equal(hasVerifiedEmail(null), false);
    assert.equal(hasVerifiedEmail(unverifiedPassword), false);
    assert.equal(hasVerifiedEmail({ email: OWNER, emailVerified: true, providerIds: ["credential"] }), true);
    assert.equal(hasVerifiedEmail({ email: OWNER, emailVerified: false, providerIds: ["grok-google"] }), true);
    assert.equal(hasVerifiedEmail({ email: OWNER, emailVerified: false, providerIds: ["grok-x"] }), false);
    assert.equal(hasVerifiedEmail({ email: null, emailVerified: true, providerIds: ["grok-google"] }), false);
  });

  it("refuses every claim on a deployed store with no allowlist", () => {
    const decision = deskAccess({ userId: "u1", ownerUserId: null, identity: googleOwner, ownerEmails: [], enforce: true });
    assert.deepEqual(decision, { status: "refused", reason: "not-configured" });
  });

  it("keeps first-claim behavior in dev/tests when no allowlist is set", () => {
    const decision = deskAccess({ userId: "dev-user", ownerUserId: null, identity: null, ownerEmails: [], enforce: false });
    assert.deepEqual(decision, { status: "claimable" });
  });

  it("refuses an unverified account even when its email is on the allowlist", () => {
    const decision = deskAccess({ userId: "u1", ownerUserId: null, identity: unverifiedPassword, ownerEmails: [OWNER], enforce: true });
    assert.deepEqual(decision, { status: "refused", reason: "unverified" });
  });

  it("refuses a verified account that is not on the allowlist", () => {
    const decision = deskAccess({
      userId: "u1",
      ownerUserId: null,
      identity: { email: "stranger@example.com", emailVerified: true, providerIds: ["grok-google"] },
      ownerEmails: [OWNER],
      enforce: true,
    });
    assert.deepEqual(decision, { status: "refused", reason: "not-allowed" });
  });

  it("lets a verified, allow-listed Google account claim (email case ignored)", () => {
    const decision = deskAccess({
      userId: "u1",
      ownerUserId: null,
      identity: { ...googleOwner, email: "Owner@Example.COM" },
      ownerEmails: parseOwnerEmails(OWNER),
      enforce: true,
    });
    assert.deepEqual(decision, { status: "claimable" });
  });

  it("once claimed, the owner is owner and everyone else is denied", () => {
    const base = { ownerUserId: "u1", identity: googleOwner, ownerEmails: [OWNER], enforce: true };
    assert.deepEqual(deskAccess({ ...base, userId: "u1" }), { status: "owner" });
    assert.deepEqual(deskAccess({ ...base, userId: "u2" }), { status: "denied" });
  });

  it("reads the allowlist and enforcement from the environment", () => {
    assert.deepEqual(deskPolicyFromEnv({ FARM_OWNER_EMAILS: OWNER, DATABASE_URL: "postgres://x/y" }), {
      ownerEmails: [OWNER],
      enforce: true,
    });
    assert.deepEqual(deskPolicyFromEnv({}), { ownerEmails: [], enforce: false });
  });
});

// ---------------------------------------------------------------------------
// Real queries against PGLite (same migrations the app applies at startup).

const MIGRATIONS = ["0001_auth.sql", "0002_shop.sql"].map((name) =>
  readFileSync(join(import.meta.dirname, "..", "..", "migrations", name), "utf8"),
);

function toSql(pg: PGlite): Sql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return (await pg.query(text, values)).rows;
  }) as unknown as Sql;
  sql.query = (async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows) as Sql["query"];
  return sql;
}

async function addUser(
  pg: PGlite,
  user: { id: string; email: string; emailVerified: boolean; providerId: string },
) {
  await pg.query(`insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, $4)`, [
    user.id,
    "Test",
    user.email,
    user.emailVerified,
  ]);
  await pg.query(
    `insert into account (id, "accountId", "providerId", "userId", "updatedAt") values ($1, $2, $3, $4, now())`,
    [`acct-${user.id}`, user.id, user.providerId, user.id],
  );
}

describe("claimDesk / adminState against the database", () => {
  let pg: PGlite;
  let sql: Sql;
  const deployed = { DATABASE_URL: "postgres://deployed/db", FARM_OWNER_EMAILS: OWNER };

  before(async () => {
    pg = new PGlite();
    for (const text of MIGRATIONS) await pg.exec(text);
    sql = toSql(pg);
  });

  beforeEach(async () => {
    await pg.exec(`truncate shop_owner, order_items, orders, session, account, "user" cascade`);
    // An unverified password account, the real owner (Google), a verified stranger,
    // and an unverified account whose email a test puts on the allowlist.
    await addUser(pg, { id: "squatter", email: "squat@example.com", emailVerified: false, providerId: "credential" });
    await addUser(pg, { id: "owner", email: OWNER, emailVerified: true, providerId: "grok-google" });
    await addUser(pg, { id: "stranger", email: "stranger@example.com", emailVerified: true, providerId: "grok-google" });
    await addUser(pg, { id: "unverified-owner", email: "owner2@example.com", emailVerified: false, providerId: "credential" });
    await pg.query(
      `insert into orders (id, owner_user_id, customer_name, customer_email, method, status, subtotal, shipping, tax, total)
       values ('HH-1', 'pending', 'Pat', 'pat@example.com', 'pickup', 'awaiting-payment', 10, 0, 0, 10)`,
    );
  });

  it("refuses everyone on a deployed store when FARM_OWNER_EMAILS is unset", async () => {
    const env = { DATABASE_URL: "postgres://deployed/db" };
    const state = await deskStateFor(sql, "owner", env);
    assert.equal(state.canClaim, false);
    assert.match(state.refusal ?? "", /FARM_OWNER_EMAILS/);
    await assert.rejects(() => claimDeskFor(sql, "owner", env), /FARM_OWNER_EMAILS/);
    assert.equal(await deskOwnerId(sql), null);
  });

  it("a non-allow-listed verified account cannot claim", async () => {
    await assert.rejects(() => claimDeskFor(sql, "stranger", deployed), /not on the farm's owner list/);
    assert.equal(await deskOwnerId(sql), null);
  });

  it("an unverified account cannot claim, even with an allow-listed email", async () => {
    const env = { ...deployed, FARM_OWNER_EMAILS: `${OWNER}, owner2@example.com` };
    await assert.rejects(() => claimDeskFor(sql, "unverified-owner", env), /not verified/);
    assert.equal(await deskOwnerId(sql), null);
  });

  it("an unknown user id (no auth row) cannot claim on a deployed store", async () => {
    await assert.rejects(() => claimDeskFor(sql, "ghost", deployed), /not verified/);
  });

  it("the allow-listed, Google-verified owner claims and takes the pending orders", async () => {
    assert.deepEqual(await deskStateFor(sql, "owner", deployed), {
      ownerExists: false,
      isOwner: false,
      canClaim: true,
      refusal: null,
    });
    assert.deepEqual(await claimDeskFor(sql, "owner", deployed), { ok: true });
    assert.equal(await deskOwnerId(sql), "owner");
    const orders = await pg.query<{ owner_user_id: string }>(`select owner_user_id from orders where id = 'HH-1'`);
    assert.equal(orders.rows[0]?.owner_user_id, "owner");
    // Claiming again is a no-op for the owner.
    assert.deepEqual(await claimDeskFor(sql, "owner", deployed), { ok: true });
    assert.deepEqual(await deskStateFor(sql, "owner", deployed), {
      ownerExists: true,
      isOwner: true,
      canClaim: false,
      refusal: null,
    });
  });

  it("after the owner claims, a second account sees the desk as denied", async () => {
    await claimDeskFor(sql, "owner", deployed);
    for (const other of ["stranger", "squatter"]) {
      assert.deepEqual(await deskStateFor(sql, other, deployed), {
        ownerExists: true,
        isOwner: false,
        canClaim: false,
        refusal: null,
      });
      await assert.rejects(() => claimDeskFor(sql, other, deployed), /belongs to another account/);
    }
    // Even another allow-listed, verified account cannot take an owned desk.
    const env = { ...deployed, FARM_OWNER_EMAILS: `${OWNER}, stranger@example.com` };
    await assert.rejects(() => claimDeskFor(sql, "stranger", env), /belongs to another account/);
    assert.equal(await deskOwnerId(sql), "owner");
  });

  it("local dev without an allowlist keeps the old first-claim behavior", async () => {
    assert.deepEqual(await claimDeskFor(sql, "dev-user", {}), { ok: true });
    assert.equal(await deskOwnerId(sql), "dev-user");
    await assert.rejects(() => claimDeskFor(sql, "owner", {}), /belongs to another account/);
  });
});
