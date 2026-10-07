import type { PoolConfig } from "pg";

/**
 * True inside the Cloudflare Workers runtime (the Cloudflare Pages dev site).
 * Node, Vercel and the sandbox preview all report something else.
 */
export const isWorkersRuntime =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * node-postgres pool settings for `DATABASE_URL`.
 *
 * Workers ties every socket to the request that opened it. A pooled connection
 * kept idle after one request and reused by the next one hangs, and the runtime
 * cancels that request. `maxUses: 1` closes each connection when its query is
 * done, so every request opens its own. Node keeps the normal shared pool.
 */
export function pgPoolConfig(connectionString: string | undefined): PoolConfig {
  return isWorkersRuntime ? { connectionString, maxUses: 1, max: 5 } : { connectionString };
}
