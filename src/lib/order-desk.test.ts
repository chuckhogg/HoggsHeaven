/**
 * Order view edits (`order-desk.server.ts`) against an in-memory PGLite
 * database built from this repo's migrations, with orders shaped like the
 * imported GoDaddy/eBay history (no recorded shipping method, unmatched
 * slugs, empty labels, long notes, cancelled/refunded history).
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db";
import {
  createDeskOrder,
  deleteDeskOrder,
  listDeskOrders,
  parseNewOrder,
  parseOrderPatch,
  readDeskOrder,
  updateDeskOrder,
} from "./order-desk.server.ts";

const MIGRATIONS = readdirSync(join(import.meta.dirname, "../../migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(import.meta.dirname, "../../migrations", name), "utf8"));

function toSql(pg: PGlite): Sql {
  const run = async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  }) as unknown as Sql;
  sql.query = run as Sql["query"];
  return sql;
}

const OWNER = "owner-1";
const LONG_NOTE = [
  "Imported from GoDaddy order history. Sales channel: Online Store. Original order #R900.",
  "Original statuses: fulfillment Fulfilled, payment Paid.",
  "Payment method: Credit/Debit Card - GoDaddy Payments",
  "Tracking #: 9400100000000000000001",
  `Special instructions: ${"leave by the side door. ".repeat(20).trim()}`,
].join("\n");
const HISTORY = [
  { at: "2024-04-12T15:20:00.000Z", status: "awaiting-payment", note: "Order placed on Online Store." },
  { at: "2024-04-16T15:20:00.000Z", status: "completed", note: "Imported as completed." },
];
// A name right at the old 80-character cap plus one, which the old edit form would have trimmed.
const LONG_NAME = "A".repeat(81);

let pg: PGlite;
let sql: Sql;

async function seed() {
  await pg.query(
    `insert into products (slug, name, kind, category, image, description) values
       ('bcm-eggs', 'Black Copper Marans Hatching Eggs', 'eggs', 'eggs', '/x.png', ''),
       ('adult-hen', 'Lavender Orpington', 'birds', 'adult', '/y.png', '')`,
  );
  await pg.query(`insert into product_shipping_methods (product_id, method_slug)
    select id, 'usps-priority' from products where slug = 'bcm-eggs'`);
  // Imported, shipped, no recorded method, stored totals that don't match today's math (discount 4.50).
  await pg.query(
    `insert into orders (id, owner_user_id, created_at, customer_name, customer_email, customer_phone, method, shipping_method,
       shipping_method_name, address, status, note, subtotal, shipping, tax, total, history)
     values ('R900', $1, '2024-04-12T15:20:00Z', $2, 'ada@example.com', '', 'ship', null, null,
       '123 Example Rd, Springfield, KY 40000', 'completed', $3, 45, 18, 0, 58.5, $4)`,
    [OWNER, LONG_NAME, LONG_NOTE, JSON.stringify(HISTORY)],
  );
  await pg.query(
    `insert into order_items (order_id, slug, variant_id, name, label, price, image, qty, sku, kind) values
       ('R900', 'bcm-eggs', null, 'Black Copper Marans Hatching Eggs', '1 Dozen', 30, '', 1, 'HEGGS-BCM12', 'eggs'),
       ('R900', 'heritage-mix-historical', null, 'Heritage Mix Eggs (discontinued)', '', 15, '', 1, '', 'eggs')`,
  );
  // Refunded eBay pickup order, imported as cancelled.
  await pg.query(
    `insert into orders (id, owner_user_id, customer_name, customer_email, method, address, status, note, subtotal, shipping, tax, total, history)
     values ('R901', $1, 'Ben Example', 'ben@example.com', 'pickup', 'Farm pickup, Shelbyville, KY 40065', 'cancelled',
       'Imported from GoDaddy order history. Sales channel: eBay.\nRefunded (GoDaddy payment status Refunded).', 40, 0, 2.4, 42.4, '[]')`,
    [OWNER],
  );
  await pg.query(
    `insert into order_items (order_id, slug, name, label, price, qty, kind) values ('R901', 'ayam-chicks-historical', 'Ayam Cemani Chicks', 'Straight run', 20, 2, 'birds')`,
  );
  // Someone else's order (another desk) must never be readable or editable.
  await pg.query(
    `insert into orders (id, owner_user_id, customer_name, customer_email, method, status, subtotal, shipping, tax, total)
     values ('X1', 'someone-else', 'Other', 'other@example.com', 'pickup', 'paid', 10, 0, 0, 10)`,
  );
}

async function rawOrder(id: string) {
  return (await pg.query<Record<string, unknown>>(`select *, subtotal::float8 as sub, shipping::float8 as ship, tax::float8 as tx, total::float8 as tot from orders where id = $1`, [id])).rows[0]!;
}

async function rawItems(id: string) {
  return (await pg.query<Record<string, unknown>>(`select slug, variant_id, name, label, price::float8 as price, qty, sku from order_items where order_id = $1 order by id`, [id])).rows;
}

describe("order view edits", () => {
  before(async () => {
    pg = new PGlite();
    for (const text of MIGRATIONS) await pg.exec(text);
    sql = toSql(pg);
  });

  beforeEach(async () => {
    await pg.exec(`truncate order_items, orders, product_shipping_methods, products restart identity cascade`);
    await pg.exec(`update shop_settings set tax_rate = 0.06 where id = 1`);
    await seed();
  });

  it("reads one order with its lines, history and legacy (null) shipping method", async () => {
    const order = await readDeskOrder(sql, OWNER, "R900");
    assert.ok(order);
    assert.equal(order.method, "ship");
    assert.equal(order.shippingMethod, null);
    assert.equal(order.items.length, 2);
    assert.equal(order.history.length, 2);
    assert.deepEqual(order.totals, { sub: 45, ship: 18, tax: 0, total: 58.5 });
    assert.equal(await readDeskOrder(sql, OWNER, "X1"), null, "another desk's order stays hidden");
    assert.equal((await listDeskOrders(sql, OWNER)).length, 2);
  });

  it("a status-only change appends history and leaves every other column untouched", async () => {
    const before = await rawOrder("R900");
    const itemsBefore = await rawItems("R900");
    const now = new Date("2026-10-08T14:00:00Z");
    const { order, changed } = await updateDeskOrder(sql, OWNER, "R900", parseOrderPatch({ status: "shipped", statusNote: "Re-shipped replacement" }), { now });
    assert.deepEqual(changed, ["status"]);
    assert.equal(order.status, "shipped");
    assert.equal(order.history.length, 3);
    assert.deepEqual(order.history[2], { at: now.toISOString(), status: "shipped", note: "Re-shipped replacement" });
    const after = await rawOrder("R900");
    for (const column of ["customer_name", "customer_email", "customer_phone", "method", "shipping_method", "address", "note", "sub", "ship", "tx", "tot"]) {
      assert.deepEqual(after[column], before[column], `${column} unchanged`);
    }
    assert.equal(after.customer_name, LONG_NAME, "an over-limit stored name is not trimmed by an unrelated edit");
    assert.deepEqual(await rawItems("R900"), itemsBefore, "lines untouched");
  });

  it("a status change without a note gets a default history note; same status adds nothing", async () => {
    const first = await updateDeskOrder(sql, OWNER, "R901", parseOrderPatch({ status: "completed" }));
    assert.equal(first.order.history.at(-1)?.note, "Status changed on the farm desk.");
    const again = await updateDeskOrder(sql, OWNER, "R901", parseOrderPatch({ status: "completed" }));
    assert.deepEqual(again.changed, []);
    assert.equal(again.order.history.length, first.order.history.length);
  });

  it("contact and note edits keep stored totals, method and address", async () => {
    const { order, changed } = await updateDeskOrder(
      sql,
      OWNER,
      "R900",
      parseOrderPatch({ name: "Ada Sample", email: "Ada.New@Example.com", phone: "555-0100", note: `${LONG_NOTE}\nCalled about hatch rate.` }),
    );
    assert.deepEqual(changed.sort(), ["customer_email", "customer_name", "customer_phone", "note"]);
    assert.equal(order.customer.email, "ada.new@example.com");
    assert.deepEqual(order.totals, { sub: 45, ship: 18, tax: 0, total: 58.5 });
    assert.equal(order.shippingMethod, null);
    assert.equal(order.address, "123 Example Rd, Springfield, KY 40000");
    assert.match(order.note, /Called about hatch rate\.$/);
  });

  it("sending the stored lines back unchanged (empty label, unmatched slug) does not reprice", async () => {
    const order = (await readDeskOrder(sql, OWNER, "R900"))!;
    const { changed, order: after } = await updateDeskOrder(
      sql,
      OWNER,
      "R900",
      parseOrderPatch({ items: order.items.map((item) => ({ ...item, variantId: item.variantId || null })), address: "", shipping: "legacy-ship" }),
    );
    assert.deepEqual(changed, []);
    assert.deepEqual(after.totals, { sub: 45, ship: 18, tax: 0, total: 58.5 });
    assert.equal(after.address, "123 Example Rd, Springfield, KY 40000", "a blank address keeps the stored one");
  });

  it("changing a line recomputes subtotal and tax but keeps the stored shipping", async () => {
    const order = (await readDeskOrder(sql, OWNER, "R900"))!;
    const items = order.items.map((item, i) => (i === 0 ? { ...item, qty: 2 } : item));
    const { changed, order: after } = await updateDeskOrder(sql, OWNER, "R900", parseOrderPatch({ items }));
    assert.ok(changed.includes("items"));
    assert.deepEqual(after.totals, { sub: 75, ship: 18, tax: 4.5, total: 97.5 });
    assert.equal(after.items[0]?.qty, 2);
    assert.equal(after.items[1]?.slug, "heritage-mix-historical", "unmatched historical slug kept");
  });

  it("adding and removing lines keeps a catalog variant id", async () => {
    const variant = (await pg.query<{ id: number }>(
      `insert into variants (product_id, sku, label, price) select id, 'HEGGS-BCM6', 'Half dozen', 18 from products where slug = 'bcm-eggs' returning id`,
    )).rows[0]!.id;
    const order = (await readDeskOrder(sql, OWNER, "R900"))!;
    const items = [order.items[0]!, { name: "Black Copper Marans Hatching Eggs", label: "Half dozen", price: 18, qty: 1, sku: "HEGGS-BCM6", kind: "eggs", slug: "bcm-eggs", variantId: variant }];
    const { order: after } = await updateDeskOrder(sql, OWNER, "R900", parseOrderPatch({ items }));
    assert.equal(after.items.length, 2);
    assert.equal(after.items[1]?.variantId, variant);
    assert.equal(after.totals.sub, 48);
  });

  it("switching method reprices shipping only; listings must allow the method; unpriced methods are refused", async () => {
    const toPickup = await updateDeskOrder(sql, OWNER, "R900", parseOrderPatch({ shipping: "pickup" }));
    assert.equal(toPickup.order.method, "pickup");
    assert.deepEqual(toPickup.order.totals, { sub: 45, ship: 0, tax: 0, total: 45 });
    assert.equal(toPickup.order.address, "123 Example Rd, Springfield, KY 40000", "address never replaced by a generated one");

    await assert.rejects(() => updateDeskOrder(sql, OWNER, "R900", parseOrderPatch({ shipping: "usps-priority-express" })), /Set a price/);
    await pg.query(`update shipping_methods set price = 40 where slug = 'usps-priority-express'`);
    await assert.rejects(
      () => updateDeskOrder(sql, OWNER, "R900", parseOrderPatch({ shipping: "usps-priority-express" })),
      /doesn't ship by USPS Priority Mail Express/,
    );
    const priority = await updateDeskOrder(sql, OWNER, "R900", parseOrderPatch({ shipping: "usps-priority" }));
    assert.equal(priority.order.shippingMethod?.slug, "usps-priority");
    assert.equal(priority.order.totals.ship, 18);
  });

  it("rejects bad input instead of silently trimming it", () => {
    assert.throws(() => parseOrderPatch({ status: "refunded" }), /valid status/);
    assert.throws(() => parseOrderPatch({ email: "nope" }), /valid email/);
    assert.throws(() => parseOrderPatch({ name: "  " }), /Name is required/);
    assert.throws(() => parseOrderPatch({ note: "x".repeat(8001) }), /too long/);
    assert.throws(() => parseOrderPatch({ items: [] }), /at least one/);
    assert.throws(() => parseOrderPatch({ items: [{ name: "Eggs", price: -1, qty: 1 }] }), /valid price/);
    assert.throws(() => parseOrderPatch({ items: [{ name: "Eggs", price: 1, qty: 0 }] }), /Quantity/);
    assert.deepEqual(parseOrderPatch({}), {});
    assert.deepEqual(Object.keys(parseOrderPatch({ phone: "", status: undefined })), ["phone"]);
  });

  it("never touches another desk's order", async () => {
    await assert.rejects(() => updateDeskOrder(sql, OWNER, "X1", parseOrderPatch({ status: "cancelled" })), /not on this desk/);
    assert.equal(await deleteDeskOrder(sql, OWNER, "X1"), false);
    assert.equal((await rawOrder("X1")).status, "paid");
  });

  it("creates a desk order at today's rates and deletes it", async () => {
    const order = await createDeskOrder(
      sql,
      OWNER,
      parseNewOrder({ name: "Cora Placeholder", email: "cora@example.com", shipping: "usps-priority", address: "9 Test St, Testville KY", items: [{ name: "Black Copper Marans Hatching Eggs", label: "1 Dozen", price: 30, qty: 2, slug: "bcm-eggs" }] }),
      { now: new Date("2026-10-08T12:00:00Z") },
    );
    assert.match(order.id, /^HH-261008-/);
    assert.deepEqual(order.totals, { sub: 60, ship: 18, tax: 3.6, total: 81.6 });
    assert.equal(order.history[0]?.note, "Added from the farm desk.");
    assert.equal(await deleteDeskOrder(sql, OWNER, order.id), true);
    assert.equal(await readDeskOrder(sql, OWNER, order.id), null);
  });
});
