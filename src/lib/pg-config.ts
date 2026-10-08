import pg from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * True inside the Cloudflare Workers runtime (the Cloudflare Pages dev site).
 * Node, Vercel and the sandbox preview all report something else.
 */
export const isWorkersRuntime =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * The slice of a node-postgres `Pool` that this app and Better Auth use.
 * `connect()` is what Kysely (Better Auth's query layer) calls, and Better Auth
 * recognizes any object with `connect` as a Postgres pool.
 */
export interface PgPoolLike {
  query<R extends QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

/** Postgres type OID -> text parser (int8, date, interval, …). */
export type TypeParsers = Readonly<Record<number, (value: string) => unknown>>;

/**
 * Most connections one request may hold open on Workers. Each connection is one
 * WebSocket, and a WebSocket counts as a single subrequest no matter how many
 * queries run over it, so a page stays far below the free plan's 50.
 */
export const WORKERS_POOL_MAX = 4;

let pendingParsers: TypeParsers = {};

/**
 * Register result parsers for every pool this module creates: node-postgres on
 * Node, and the Neon serverless driver (its own copy of pg-types) on Workers.
 */
export function setPgTypeParsers(parsers: TypeParsers): void {
  pendingParsers = { ...pendingParsers, ...parsers };
  for (const [oid, parse] of Object.entries(parsers)) pg.types.setTypeParser(Number(oid), parse);
  if (neonModule) applyNeonParsers(neonModule);
}

type NeonModule = typeof import("@neondatabase/serverless");
type NeonPool = InstanceType<NeonModule["Pool"]>;
let neonModule: NeonModule | null = null;

function applyNeonParsers(mod: NeonModule) {
  for (const [oid, parse] of Object.entries(pendingParsers)) mod.types.setTypeParser(Number(oid), parse);
}

async function loadNeon(): Promise<NeonModule> {
  if (!neonModule) {
    const mod = await import("@neondatabase/serverless");
    applyNeonParsers(mod);
    neonModule = mod;
  }
  return neonModule;
}

/**
 * The object that identifies the current HTTP request (TanStack Start keeps it
 * in AsyncLocalStorage), or null outside a request.
 */
async function currentRequestKey(): Promise<object | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    return getRequest() ?? null;
  } catch {
    return null;
  }
}

/**
 * Workers pool: one Neon serverless (WebSocket) pool PER REQUEST.
 *
 * Workers ties every socket to the request that opened it, so a connection
 * cannot be shared across requests (the old node-postgres setup used
 * `maxUses: 1` for that, which opened a new connection, i.e. a new subrequest,
 * for every single query and hit the free plan's 50-subrequest cap). Here all
 * queries in one request share up to `WORKERS_POOL_MAX` WebSockets. Pools are
 * keyed by the request object in a WeakMap, so they are dropped with it, and
 * Workers closes the sockets when the request ends.
 *
 * `connect()` hands back a dedicated client, so `BEGIN … COMMIT` transactions
 * (Better Auth's, or any future app code) keep working exactly as on `pg`.
 */
class RequestScopedNeonPool implements PgPoolLike {
  readonly #connectionString: string;
  readonly #pools = new WeakMap<object, NeonPool>();

  constructor(connectionString: string) {
    this.#connectionString = connectionString;
  }

  async #poolFor(key: object): Promise<NeonPool> {
    const { Pool } = await loadNeon();
    let pool = this.#pools.get(key);
    if (!pool) {
      pool = new Pool({ connectionString: this.#connectionString, max: WORKERS_POOL_MAX });
      // A dropped socket must not crash the isolate; the next query reconnects.
      pool.on("error", (err: Error) => console.error("[db] idle connection error:", err.message));
      this.#pools.set(key, pool);
    }
    return pool;
  }

  /** Outside any request (should not happen in practice): a one-shot pool, closed after use. */
  async #oneShotPool(): Promise<NeonPool> {
    const { Pool } = await loadNeon();
    return new Pool({ connectionString: this.#connectionString, max: 1 });
  }

  async query<R extends QueryResultRow = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const key = await currentRequestKey();
    if (key) {
      const pool = await this.#poolFor(key);
      return (await pool.query(text, params)) as unknown as QueryResult<R>;
    }
    const pool = await this.#oneShotPool();
    try {
      return (await pool.query(text, params)) as unknown as QueryResult<R>;
    } finally {
      await pool.end();
    }
  }

  async connect(): Promise<PoolClient> {
    const key = await currentRequestKey();
    if (key) return (await (await this.#poolFor(key)).connect()) as unknown as PoolClient;
    const pool = await this.#oneShotPool();
    const client = await pool.connect();
    const release = client.release.bind(client);
    client.release = ((err?: Error | boolean) => {
      release(err);
      void pool.end();
    }) as typeof client.release;
    return client as unknown as PoolClient;
  }

  async end(): Promise<void> {
    // Per-request pools go away with their request.
  }
}

/**
 * The Postgres pool for `DATABASE_URL`.
 *
 * - Node (local, Vercel, scripts): node-postgres' normal shared pool.
 * - Cloudflare Workers (dev.hoggsheaven.farm): Neon's serverless driver over
 *   WebSockets, one small pool per request (see `RequestScopedNeonPool`).
 */
export function createPgPool(connectionString: string): PgPoolLike {
  if (isWorkersRuntime) return new RequestScopedNeonPool(connectionString);
  return new pg.Pool({ connectionString }) as unknown as PgPoolLike;
}
