/**
 * Farm desk ownership checks against the database (server-only).
 *
 * `shop.functions.ts` wires these into `adminState` / `claimDesk`; the rules
 * themselves live in `auth/farm-access.ts`. Split out so the tests can run the
 * real queries against an in-memory PGLite database.
 */
import type { Sql } from "./db";
import {
  deskAccess,
  deskPolicyFromEnv,
  deskRefusalMessage,
  type DeskAccess,
  type DeskIdentity,
  type EnvLike,
} from "./auth/farm-access.ts";

export async function deskOwnerId(sql: Sql): Promise<string | null> {
  const rows = await sql<{ user_id: string }>`select user_id from shop_owner where id = 1`;
  return rows[0]?.user_id ?? null;
}

/**
 * The signed-in user's email + verification state, read from Better Auth's own
 * tables (same database). Null for the auth-off dev user, who has no row, or
 * when the auth tables are missing: a missing identity never counts as verified.
 */
export async function readDeskIdentity(sql: Sql, userId: string): Promise<DeskIdentity | null> {
  try {
    const users = await sql<{ email: string; email_verified: boolean }>`
      select email, "emailVerified" as email_verified from "user" where id = ${userId}
    `;
    if (!users[0]) return null;
    const accounts = await sql<{ provider_id: string }>`
      select "providerId" as provider_id from account where "userId" = ${userId}
    `;
    return {
      email: users[0].email,
      emailVerified: users[0].email_verified === true,
      providerIds: accounts.map((row) => row.provider_id),
    };
  } catch {
    return null;
  }
}

export async function readDeskAccess(sql: Sql, userId: string, env: EnvLike): Promise<DeskAccess> {
  const policy = deskPolicyFromEnv(env);
  return deskAccess({
    userId,
    ownerUserId: await deskOwnerId(sql),
    identity: await readDeskIdentity(sql, userId),
    ownerEmails: policy.ownerEmails,
    enforce: policy.enforce,
  });
}

export type DeskState = {
  ownerExists: boolean;
  isOwner: boolean;
  canClaim: boolean;
  /** Why this user may not claim an unowned desk, or null. */
  refusal: string | null;
};

export async function deskStateFor(sql: Sql, userId: string, env: EnvLike): Promise<DeskState> {
  const access = await readDeskAccess(sql, userId, env);
  return {
    ownerExists: access.status === "owner" || access.status === "denied",
    isOwner: access.status === "owner",
    canClaim: access.status === "claimable",
    refusal: access.status === "refused" ? deskRefusalMessage(access.reason) : null,
  };
}

export const DESK_TAKEN_MESSAGE = "This farm desk belongs to another account.";

/** Claim the desk for `userId`, or throw a user-facing reason. Idempotent for the owner. */
export async function claimDeskFor(sql: Sql, userId: string, env: EnvLike): Promise<{ ok: true }> {
  const access = await readDeskAccess(sql, userId, env);
  if (access.status === "owner") return { ok: true };
  if (access.status === "denied") throw new Error(DESK_TAKEN_MESSAGE);
  if (access.status === "refused") throw new Error(deskRefusalMessage(access.reason));
  // Single-row table: a racing second claim inserts nothing and is then denied.
  await sql`insert into shop_owner (id, user_id) values (1, ${userId}) on conflict (id) do nothing`;
  if ((await deskOwnerId(sql)) !== userId) throw new Error(DESK_TAKEN_MESSAGE);
  await sql`update orders set owner_user_id = ${userId} where owner_user_id = 'pending'`;
  return { ok: true };
}
