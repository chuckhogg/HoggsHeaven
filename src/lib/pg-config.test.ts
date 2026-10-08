/**
 * Database pool selection (`pg-config.ts`).
 *
 * - Node: node-postgres' normal shared pool.
 * - Cloudflare Workers: Neon serverless over WebSocket, one small pool per
 *   request. The Workers test needs a real database, so it only runs when
 *   `HH_TEST_DATABASE_URL` is set (it creates and drops a temp table only).
 *   It counts WebSockets, because each one is one Cloudflare subrequest.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

describe("createPgPool on Node", () => {
  it("returns node-postgres' shared pool (no connection until queried)", async () => {
    const { createPgPool, isWorkersRuntime } = await import("./pg-config.ts");
    assert.equal(isWorkersRuntime, false);
    const pool = createPgPool("postgres://user:pass@localhost:1/none");
    assert.ok(pool instanceof pg.Pool);
    await pool.end();
  });
});

const testUrl = process.env.HH_TEST_DATABASE_URL?.trim();

describe("createPgPool on Cloudflare Workers (simulated)", { skip: !testUrl && "HH_TEST_DATABASE_URL not set" }, () => {
  it("runs 60 queries and a transaction in one request over at most WORKERS_POOL_MAX WebSockets", async () => {
    // Pretend to be Workers before loading a fresh copy of the module.
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
    let sockets = 0;
    const RealWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class extends RealWebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        sockets += 1;
      }
    } as typeof WebSocket;
    // TanStack Start keeps the current request in this AsyncLocalStorage.
    const key = Symbol.for("tanstack-start:event-storage");
    const g = globalThis as unknown as Record<symbol, AsyncLocalStorage<unknown>>;
    g[key] ??= new AsyncLocalStorage();
    const storage = g[key];
    try {
      const mod = await import(`./pg-config.ts?workers=${Date.now()}`);
      assert.equal(mod.isWorkersRuntime, true);
      const pool = mod.createPgPool(testUrl as string);
      const fakeRequest = () => ({ h3Event: { req: new Request("https://dev.hoggsheaven.farm/shop") } });

      await storage.run(fakeRequest(), async () => {
        for (let i = 0; i < 60; i += 1) {
          const res = await pool.query("select $1::int as n", [i]);
          assert.equal(res.rows[0].n, i);
        }
        // Parallel queries share the same small pool.
        await Promise.all(Array.from({ length: 10 }, (_, i) => pool.query("select $1::int as n", [i])));
        // A transaction on a dedicated client: rollback really undoes the insert.
        const client = await pool.connect();
        try {
          await client.query("create temp table hh_pool_test (n int)");
          await client.query("begin");
          await client.query("insert into hh_pool_test values (1)");
          await client.query("rollback");
          const after = await client.query("select count(*)::int as n from hh_pool_test");
          assert.equal(after.rows[0].n, 0);
          await client.query("begin");
          await client.query("insert into hh_pool_test values (2)");
          await client.query("commit");
          const committed = await client.query("select count(*)::int as n from hh_pool_test");
          assert.equal(committed.rows[0].n, 1);
          await client.query("drop table hh_pool_test");
        } finally {
          client.release();
        }
      });
      assert.ok(sockets >= 1 && sockets <= mod.WORKERS_POOL_MAX, `one request opened ${sockets} WebSockets`);

      // A second request gets its own connections (Workers forbids sharing).
      const before = sockets;
      await storage.run(fakeRequest(), async () => {
        await pool.query("select 1");
      });
      assert.equal(sockets, before + 1);
    } finally {
      globalThis.WebSocket = RealWebSocket;
      Reflect.deleteProperty(globalThis, "navigator");
    }
  });
});
