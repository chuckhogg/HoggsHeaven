// migrations/0003_shipping.sql against an embedded Postgres (PGlite) that
// looks like the live store: listings and imported orders already exist.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sqlFile = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");

async function liveLikeDb({ shipEggs = 25 } = {}) {
  const db = new PGlite();
  await db.exec(await sqlFile("0002_shop.sql"));
  await db.query("update shop_settings set ship_eggs = $1 where id = 1", [shipEggs]);
  const listings = [
    ["eggs-1", "Black Copper Maran Hatching Eggs", "eggs", ["1/2 Dozen (6) Hatching Eggs", "1 Dozen (12) Hatching Eggs"]],
    ["chick-1", "MARSBAR", "birds", ["Day Old Chick Straight Run"]],
    ["chick-2", "White Legbar", "birds", ["6 Day Old Chicks Straight Run", "12 Day Old Chicks Straight Run"]],
    ["adult-1", "Lavender Orpington", "birds", ["Standard"]],
    ["mixed-1", "Bresse", "birds", ["Day Old Chick Straight Run", "4+ Month Cockerel/Pullet"]],
  ];
  for (const [slug, name, kind, labels] of listings) {
    const { rows } = await db.query("insert into products (slug, name, kind, image) values ($1, $2, $3, '') returning id", [slug, name, kind]);
    for (const label of labels) {
      await db.query("insert into variants (product_id, sku, label, price) values ($1, 'X', $2, 10)", [rows[0].id, label]);
    }
  }
  await db.query(
    `insert into orders (id, owner_user_id, customer_name, customer_email, method, address, status, subtotal, shipping, tax, total)
     values ('R1', 'u', 'A', 'a@example.com', 'ship', '1 Road', 'completed', 50, 14.35, 0, 64.35),
            ('R2', 'u', 'B', 'b@example.com', 'pickup', '2 Lane', 'completed', 30, 0, 0, 30)`,
  );
  await db.exec(await sqlFile("0003_shipping.sql"));
  return db;
}

test("seeds six methods; only USPS Priority Mail is priced, at the existing egg rate", async () => {
  const db = await liveLikeDb({ shipEggs: 25 });
  const { rows } = await db.query("select slug, carrier, name, price::float8 as price, active from shipping_methods order by sort_order");
  assert.deepEqual(
    rows.map((r) => [r.slug, r.carrier, r.name, r.price]),
    [
      ["usps-priority", "USPS", "USPS Priority Mail", 25],
      ["usps-priority-express", "USPS", "USPS Priority Mail Express", null],
      ["ups-ground", "UPS", "UPS Ground", null],
      ["ups-3-day", "UPS", "UPS 3 Day Select", null],
      ["ups-2-day", "UPS", "UPS 2nd Day Air", null],
      ["ups-next-day", "UPS", "UPS Next Day Air", null],
    ],
  );
  assert.ok(rows.every((r) => r.active === true));
});

test("categorizes listings and assigns the default methods", async () => {
  const db = await liveLikeDb();
  const { rows } = await db.query(
    `select p.slug, p.category, coalesce(array_agg(m.method_slug order by sm.sort_order) filter (where m.method_slug is not null), '{}') as methods
     from products p
     left join product_shipping_methods m on m.product_id = p.id
     left join shipping_methods sm on sm.slug = m.method_slug
     group by p.slug, p.category order by p.slug`,
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
  assert.equal(bySlug["eggs-1"].category, "eggs");
  assert.deepEqual(bySlug["eggs-1"].methods, ["usps-priority", "ups-ground", "ups-3-day", "ups-2-day", "ups-next-day"]);
  assert.equal(bySlug["chick-1"].category, "chicks");
  assert.equal(bySlug["chick-2"].category, "chicks");
  assert.deepEqual(bySlug["chick-1"].methods, ["usps-priority", "usps-priority-express"]);
  assert.equal(bySlug["adult-1"].category, "adult");
  assert.deepEqual(bySlug["adult-1"].methods, ["usps-priority-express"]);
  assert.equal(bySlug["mixed-1"].category, "adult", "a listing mixing chicks and grown birds is treated as adult");
});

test("historical orders are untouched and have no recorded method", async () => {
  const db = await liveLikeDb();
  const { rows } = await db.query(
    "select id, method, address, shipping::float8 as shipping, total::float8 as total, shipping_method, shipping_method_name from orders order by id",
  );
  assert.deepEqual(rows, [
    { id: "R1", method: "ship", address: "1 Road", shipping: 14.35, total: 64.35, shipping_method: null, shipping_method_name: null },
    { id: "R2", method: "pickup", address: "2 Lane", shipping: 0, total: 30, shipping_method: null, shipping_method_name: null },
  ]);
});

test("category must agree with kind, and deleting a listing drops its assignments", async () => {
  const db = await liveLikeDb();
  await assert.rejects(db.query("update products set category = 'chicks' where slug = 'eggs-1'"));
  await assert.rejects(db.query("insert into products (slug, name, kind, image) values ('x', 'X', 'eggs', '')"), /category/);
  await db.query("delete from products where slug = 'adult-1'");
  const { rows } = await db.query("select count(*)::int as n from product_shipping_methods m left join products p on p.id = m.product_id where p.id is null");
  assert.equal(rows[0].n, 0);
});

test("a fresh database (no listings yet) still migrates", async () => {
  const db = new PGlite();
  await db.exec(await sqlFile("0002_shop.sql"));
  await db.exec(await sqlFile("0003_shipping.sql"));
  const { rows } = await db.query("select price::float8 as price from shipping_methods where slug = 'usps-priority'");
  assert.equal(rows[0].price, 18);
});
