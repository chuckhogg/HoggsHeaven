// Tests for the historical order import. All rows here are synthetic; the real
// export holds customer details and must never be committed.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import {
  FARM_PICKUP_ADDRESS,
  buildOrders,
  centsToDecimal,
  cleanTracking,
  lineKind,
  mapStatus,
  matchCatalog,
  optionLabel,
  parseCsv,
  parseMoney,
  parseTimestamp,
  importOrders,
  summarize,
} from "./import-orders-lib.mjs";
import { parseArgs, pickDriver } from "./import-orders.mjs";
import { pendingMigrations } from "./migration-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const run = promisify(execFile);

const HEADER = [
  "Order #",
  "Email Address",
  "Order Date and Time Stamp",
  "Fulfillment Status",
  "Payment Status",
  "Payment Date and Time Stamp",
  "Fulfillment Date and Time Stamp",
  "Currency",
  "Subtotal",
  "Shipping Method",
  "Shipping Cost",
  "Tax Method",
  "Taxes",
  "Total",
  "Coupon Code",
  "Coupon Code Name",
  "Discount",
  "Billing Name",
  "Billing Country",
  "Billing Street Address",
  "Billing Street Address 2",
  "Billing City",
  "Billing State",
  "Billing Zip",
  "Billing Phone",
  "Shipping Name",
  "Shipping Country",
  "Shipping Street Address",
  "Shipping Street Address 2",
  "Shipping City",
  "Shipping State",
  "Shipping Zip",
  "Shipping Phone",
  "Gift Cards",
  "Payment Method",
  "Tracking #",
  "Special Instructions",
  "Sales Channel",
  "LineItem Name",
  "LineItem SKU",
  "LineItem Options",
  "LineItem Add-ons",
  "LineItem Qty",
  "LineItem Sale Price",
  "Download Status",
  "LineItem Type",
];

/** One synthetic CSV row; override any column. */
function row(overrides = {}) {
  return {
    "Order #": "R100000001",
    "Email Address": "Pat.Example@example.test",
    "Order Date and Time Stamp": "2025-04-01 15:30:00 +0000",
    "Fulfillment Status": "Fulfilled",
    "Payment Status": "Paid",
    "Payment Date and Time Stamp": "2025-04-01 15:30:05 +0000",
    "Fulfillment Date and Time Stamp": "2025-04-03 12:00:00 +0000",
    Currency: "USD",
    Subtotal: "$50.00",
    "Shipping Method": "Flat Rate",
    "Shipping Cost": "$18.00",
    "Tax Method": "",
    Taxes: "$0.00",
    Total: "$68.00",
    "Coupon Code": "",
    "Coupon Code Name": "",
    Discount: "$0.00",
    "Billing Name": "Pat Example",
    "Billing Country": "USA",
    "Billing Street Address": "1 Test Lane",
    "Billing Street Address 2": "",
    "Billing City": "Testville",
    "Billing State": "KY",
    "Billing Zip": "40000",
    "Billing Phone": "5550100",
    "Shipping Name": "Pat Example",
    "Shipping Country": "USA",
    "Shipping Street Address": "1 Test Lane",
    "Shipping Street Address 2": "",
    "Shipping City": "Testville",
    "Shipping State": "KY",
    "Shipping Zip": "40000",
    "Shipping Phone": "5550100",
    "Gift Cards": "",
    "Payment Method": "Credit/Debit Card - GoDaddy Payments $68.00",
    "Tracking #": '="9400000000000000000001"',
    "Special Instructions": "",
    "Sales Channel": "Online Store",
    "LineItem Name": "Test Breed Hatching Eggs",
    "LineItem SKU": "TB-HEGGS-12",
    "LineItem Options": "Breed Option:1 Dozen (12) Hatching Eggs",
    "LineItem Add-ons": "",
    "LineItem Qty": "1",
    "LineItem Sale Price": "$50.00",
    "Download Status": "N/A",
    "LineItem Type": "physical",
    ...overrides,
  };
}

function toCsv(rows) {
  const cell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [HEADER, ...rows.map((r) => HEADER.map((h) => r[h] ?? ""))]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
}

const CATALOG = [
  {
    slug: "test-breed-eggs",
    name: "Test Breed Hatching Eggs",
    kind: "eggs",
    image: "https://example.test/eggs.jpg",
    variants: [
      { id: 11, sku: "TB-HEGGS-12", label: "1 Dozen (12) Hatching Eggs" },
      { id: 12, sku: "TB-HEGGS-6", label: "1/2 Dozen (6) Hatching Eggs" },
    ],
  },
  {
    slug: "test-breed",
    name: "Test Breed",
    kind: "birds",
    image: "https://example.test/chick.jpg",
    variants: [{ id: 21, sku: "TB-DAY-OLD", label: "Day Old Chick Straight Run" }],
  },
  {
    slug: "other-eggs",
    name: "Other Bird Hatching Eggs (XYZ)",
    kind: "eggs",
    variants: [{ id: 31, sku: "OB-1", label: "Dozen" }],
  },
];

const NOW = new Date("2026-10-01T00:00:00Z");

async function freshDb() {
  const db = new PGlite();
  await db.waitReady;
  const dir = join(root, "migrations");
  for (const { name } of pendingMigrations(await readdir(dir), [])) {
    await db.exec(await readFile(join(dir, name), "utf8"));
  }
  return { db, client: { query: async (text, params) => (await db.query(text, params)).rows } };
}

test("parseMoney handles $, -$, commas and blanks as exact cents", () => {
  assert.equal(parseMoney("$30.00"), 3000);
  assert.equal(parseMoney("-$30.00"), -3000);
  assert.equal(parseMoney("$-5.50"), -550);
  assert.equal(parseMoney("$1,234.5"), 123450);
  assert.equal(parseMoney("$0.07"), 7);
  assert.equal(parseMoney(""), 0);
  assert.equal(parseMoney(" 12 "), 1200);
  assert.throws(() => parseMoney("twelve"), /Unrecognised money/);
  assert.throws(() => parseMoney("$1.234"), /Unrecognised money/);
  assert.equal(centsToDecimal(-3000), "-30.00");
  assert.equal(centsToDecimal(7), "0.07");
});

test("parseTimestamp converts GoDaddy +0000 stamps (and other offsets) to UTC ISO", () => {
  assert.equal(parseTimestamp("2026-06-30 14:54:18 +0000"), "2026-06-30T14:54:18.000Z");
  assert.equal(parseTimestamp("2026-01-01 00:30:00 +0530"), "2025-12-31T19:00:00.000Z");
  assert.equal(parseTimestamp("2026-03-08 01:00:00 -0500"), "2026-03-08T06:00:00.000Z");
  assert.equal(parseTimestamp(""), null);
  assert.throws(() => parseTimestamp("06/30/2026"), /Unrecognised timestamp/);
});

test('cleanTracking strips the Excel ="..." wrapper', () => {
  assert.equal(cleanTracking('="9400111100000000000000"'), "9400111100000000000000");
  assert.equal(cleanTracking("1Z999"), "1Z999");
  assert.equal(cleanTracking(""), "");
});

test("parseCsv handles quotes, escaped quotes, embedded commas/newlines, CRLF and a BOM", () => {
  const text = '\ufeffa,b,c\r\n1,"two, too","say ""hi""\nthere"\r\n4,,6\n';
  const { header, rows } = parseCsv(text);
  assert.deepEqual(header, ["a", "b", "c"]);
  assert.deepEqual(rows, [
    { a: "1", b: "two, too", c: 'say "hi"\nthere' },
    { a: "4", b: "", c: "6" },
  ]);
  assert.throws(() => parseCsv("a,b\n1,2,3\n"), /has 3 fields/);
  assert.throws(() => parseCsv('a\n"open'), /quoted field/);
});

test("mapStatus follows the documented GoDaddy -> app mapping", () => {
  const cases = [
    ["Cancelled", "Unpaid", "cancelled", false],
    ["Cancelled", "Paid", "cancelled", false],
    ["Cancelled", "Refunded", "cancelled", true],
    ["Fulfilled", "Refunded", "cancelled", true],
    ["Unfulfilled", "Refunded", "cancelled", true],
    ["Fulfilled", "Paid", "completed", false],
    ["Fulfilled", "Unpaid", "completed", false],
    ["Awaiting Pickup", "Paid", "ready-for-pickup", false],
    ["Awaiting Pickup", "Unpaid", "awaiting-payment", false],
    ["Unfulfilled", "Paid", "paid", false],
    ["Unfulfilled", "Unpaid", "awaiting-payment", false],
  ];
  for (const [f, p, status, refunded] of cases) {
    assert.deepEqual(mapStatus(f, p), { status, refunded }, `${f} / ${p}`);
  }
  assert.throws(() => mapStatus("Shipped", "Paid"), /Unknown fulfillment/);
  assert.throws(() => mapStatus("Fulfilled", "Pending"), /Unknown payment/);
});

test("line helpers: option label, egg vs bird kind, catalog matching", () => {
  assert.equal(
    optionLabel("Breed Option:Day Old Chick Straight Run"),
    "Day Old Chick Straight Run",
  );
  assert.equal(
    optionLabel("1/2 Dozen (6) Hatching Eggs:1/2 Dozen (6) Hatching Eggs"),
    "1/2 Dozen (6) Hatching Eggs",
  );
  assert.equal(optionLabel(""), "");
  assert.equal(lineKind({ name: "Anything", sku: "XX-HEGGS-6", label: "" }), "eggs");
  assert.equal(lineKind({ name: "Test Breed Hatching Eggs", sku: "", label: "" }), "eggs");
  assert.equal(lineKind({ name: "Test Breed", sku: "TB-12", label: "12 Hatching Eggs" }), "eggs");
  assert.equal(
    lineKind({ name: "Test Breed", sku: "TB-DAY-OLD", label: "Day Old Chick Straight Run" }),
    "birds",
  );

  const m = (name, sku, label, kind) => matchCatalog({ name, sku, label, kind }, CATALOG);
  assert.deepEqual(m("Renamed listing", "tb-heggs-6", "", "eggs"), {
    slug: "test-breed-eggs",
    variantId: 12,
    image: "https://example.test/eggs.jpg",
    matched: "sku",
  });
  assert.equal(
    m(
      "Test Breed Hatching Eggs (1 Dozen (12) Hatching Eggs)",
      "OLD",
      "1 Dozen (12) Hatching Eggs",
      "eggs",
    ).variantId,
    11,
  );
  assert.equal(m("Other Bird Hatching Eggs", "", "", "eggs").slug, "other-eggs");
  assert.equal(m("Test Breed", "TB-12-OLD", "12 Hatching Eggs", "eggs").slug, "test-breed-eggs");
  assert.deepEqual(
    m("Test Breed Hatching Eggs 1 Dozen", "TB-HEGGS-1-2", "", "eggs").matched,
    "name",
  );
  assert.deepEqual(m("Mystery", "TB-HEGGS9", "", "eggs"), {
    slug: "test-breed-eggs",
    variantId: null,
    image: "https://example.test/eggs.jpg",
    matched: "sku-stem",
  });
  assert.equal(
    m("12+ NPIP TEST BREED Chicken Hatching Eggs FREE RANGE!", "", "", "eggs").matched,
    "words",
  );
  // Unmatched lines get a stable slug that never points at the other kind's listing.
  assert.deepEqual(m("Other Eggs", "", "", "birds"), {
    slug: "other-eggs-birds",
    variantId: null,
    image: "",
    matched: "none",
  });
  assert.equal(m("Test Breed Juvenile", "", "", "birds").matched, "words");
  assert.equal(m("Rare Duck", "", "", "birds").slug, "rare-duck");
});

test("buildOrders groups line rows by Order # and keeps CSV money exactly", () => {
  const rows = [
    row({
      Subtotal: "$65.00",
      Total: "$83.00",
      "Payment Method": "Credit/Debit Card - GoDaddy Payments $83.00",
    }),
    row({
      Subtotal: "$65.00",
      Total: "$83.00",
      "Payment Method": "Credit/Debit Card - GoDaddy Payments $83.00",
      "LineItem Name": "Test Breed Hatching Eggs",
      "LineItem SKU": "TB-HEGGS-6",
      "LineItem Options": "Breed Option:1/2 Dozen (6) Hatching Eggs",
      "LineItem Qty": "3",
      "LineItem Sale Price": "$5.00",
    }),
    row({
      "Order #": "R100000002",
      "Shipping Method": "In-Person Scheduled Pickup",
      "Shipping Street Address": "",
      "Billing Street Address": "",
      "Shipping Cost": "$0.00",
      Subtotal: "$15.00",
      Total: "$15.00",
      "LineItem Name": "Test Breed",
      "LineItem SKU": "TB-DAY-OLD",
      "LineItem Options": "Breed Option:Day Old Chick Straight Run",
      "LineItem Sale Price": "$15.00",
      "Payment Status": "Unpaid",
      "Payment Method": "",
      "Payment Date and Time Stamp": "",
      "Fulfillment Status": "Awaiting Pickup",
      "Fulfillment Date and Time Stamp": "",
      "Tracking #": "",
    }),
  ];
  const orders = buildOrders(parseCsv(toCsv(rows)).rows, { catalog: CATALOG, now: NOW });
  assert.equal(orders.length, 2);
  const [a, b] = orders;
  assert.equal(a.id, "R100000001");
  assert.equal(a.lines.length, 2);
  assert.deepEqual(
    a.lines.map((l) => [l.sku, l.qty, l.priceCents, l.kind, l.variantId, l.label]),
    [
      ["TB-HEGGS-12", 1, 5000, "eggs", 11, "1 Dozen (12) Hatching Eggs"],
      ["TB-HEGGS-6", 3, 500, "eggs", 12, "1/2 Dozen (6) Hatching Eggs"],
    ],
  );
  assert.deepEqual(
    [a.subtotalCents, a.shippingCents, a.taxCents, a.totalCents],
    [6500, 1800, 0, 8300],
  );
  assert.equal(a.createdAt, "2025-04-01T15:30:00.000Z");
  assert.equal(a.method, "ship");
  assert.equal(a.status, "completed");
  assert.equal(a.customerEmail, "pat.example@example.test");
  assert.equal(a.address, "1 Test Lane, Testville, KY 40000");
  assert.match(a.note, /Sales channel: Online Store/);
  assert.match(a.note, /Tracking #: 9400000000000000000001$/m);
  assert.doesNotMatch(a.note, /="/);
  assert.match(a.note, /Payment method: Credit\/Debit Card - GoDaddy Payments \$83\.00/);
  assert.doesNotMatch(a.note, /Billing:/, "billing identical to shipping is not repeated");
  assert.deepEqual(
    a.history.map((h) => [h.at, h.status]),
    [
      ["2025-04-01T15:30:00.000Z", "awaiting-payment"],
      ["2025-04-01T15:30:05.000Z", "paid"],
      ["2025-04-03T12:00:00.000Z", "completed"],
      ["2025-04-03T12:00:00.000Z", "completed"],
    ],
  );
  assert.match(a.history.at(-1).note, /fulfillment Fulfilled, payment Paid/);
  assert.deepEqual(a.oddities, []);

  assert.equal(b.method, "pickup");
  assert.equal(b.address, FARM_PICKUP_ADDRESS);
  assert.equal(b.status, "awaiting-payment");
  assert.equal(b.lines[0].kind, "birds");
  assert.deepEqual(
    b.history.map((h) => h.status),
    ["awaiting-payment", "awaiting-payment"],
  );
  assert.ok(b.oddities.some((o) => /still "Awaiting Pickup" \(unpaid\) after \d+ days/.test(o)));
});

test("buildOrders: refunds, coupons, billing fallback and oddity flags", () => {
  const rows = [
    row({
      "Order #": "R2",
      "Fulfillment Status": "Fulfilled",
      "Payment Status": "Refunded",
      "Payment Method":
        "Apple Pay - GoDaddy Payments $68.00;Credit/Debit Card - GoDaddy Payments -$68.00",
    }),
    row({
      "Order #": "R3",
      "Coupon Code": "friend",
      "Coupon Code Name": "$50.00 off",
      Discount: "-$50.00",
      Total: "$18.00",
      "Special Instructions": "Leave at gate",
      "Shipping Street Address": "",
      "Billing Street Address": "9 Bill Rd",
      "Billing Name": "Bill Payer",
      "Shipping Name": "Pat Example",
    }),
    row({
      "Order #": "R4",
      "Payment Status": "Unpaid",
      "Payment Method": "",
      "Payment Date and Time Stamp": "",
      "LineItem Name": "Test Breed",
      "LineItem SKU": "TB-DAY-OLD",
      "LineItem Options": "Breed Option:Day Old Chick Straight Run",
    }),
    row({ "Order #": "R5", Total: "$99.00" }),
    row({
      "Order #": "R6_TEST",
      "Sales Channel": "eBay",
      "Shipping Method": "_marketplace_",
      "Shipping Street Address": "N/A",
      "Billing Street Address": "N/A",
      "Billing Country": "TCD",
      "Payment Method": "",
      "Tracking #": "",
    }),
  ];
  const byId = Object.fromEntries(
    buildOrders(parseCsv(toCsv(rows)).rows, { catalog: CATALOG, now: NOW }).map((o) => [o.id, o]),
  );

  assert.equal(byId.R2.status, "cancelled");
  assert.equal(byId.R2.refunded, true);
  assert.match(byId.R2.note, /Refunded/);
  assert.match(
    byId.R2.note,
    /Apple Pay - GoDaddy Payments \$68\.00; Credit\/Debit Card - GoDaddy Payments -\$68\.00/,
  );
  assert.equal(byId.R2.history.at(-1).status, "cancelled");
  assert.match(byId.R2.history.at(-1).note, /Refunded/);
  assert.ok(byId.R2.oddities.some((o) => /refunded while fulfillment was "Fulfilled"/.test(o)));

  assert.equal(byId.R3.discountCents, -5000);
  assert.equal(byId.R3.totalCents, 1800);
  assert.match(byId.R3.note, /Coupon: friend \(\$50\.00 off\)/);
  assert.match(byId.R3.note, /Discount: -\$50\.00/);
  assert.match(byId.R3.note, /Special instructions: Leave at gate/);
  assert.equal(
    byId.R3.address,
    "9 Bill Rd, Testville, KY 40000",
    "falls back to the billing address",
  );
  assert.match(byId.R3.note, /Billing: Bill Payer/);
  assert.deepEqual(byId.R3.oddities, []);

  assert.equal(byId.R4.status, "completed");
  assert.ok(byId.R4.oddities.includes("fulfilled but payment status Unpaid"));
  assert.ok(byId.R4.oddities.some((o) => /shipped order contains live birds: Test Breed/.test(o)));
  assert.equal(
    byId.R4.history.some((h) => h.status === "paid"),
    false,
    "no payment is invented",
  );

  assert.ok(byId.R5.oddities.some((o) => /but total is \$99\.00/.test(o)));
  assert.equal(byId.R5.totalCents, 9900, "the CSV total is kept even when it does not add up");

  assert.equal(byId.R6_TEST.address, "");
  assert.equal(byId.R6_TEST.channel, "eBay");
  assert.doesNotMatch(byId.R6_TEST.note, /Billing:/, "eBay placeholder billing (N/A) is ignored");
  assert.ok(byId.R6_TEST.oddities.includes("ship order with no shipping or billing address"));
  assert.ok(byId.R6_TEST.oddities.some((o) => /test order/.test(o)));

  const s = summarize(Object.values(byId));
  assert.equal(s.orders, 5);
  assert.equal(s.lines, 5);
  assert.deepEqual(s.statuses, { cancelled: 1, completed: 4 });
  assert.equal(s.totalCents, 6800 + 1800 + 6800 + 9900 + 6800);
  assert.equal(s.nonCancelledTotalCents, 1800 + 6800 + 9900 + 6800);
});

test("buildOrders rejects rows it cannot import faithfully", () => {
  assert.throws(() => buildOrders([row({ "Order #": "" })]), /no Order #/);
  assert.throws(() => buildOrders([row({ "LineItem Qty": "0" })]), /bad quantity/);
  assert.throws(() => buildOrders([row({ Total: "lots" })]), /Unrecognised money/);
  assert.throws(() => buildOrders([row({ "Fulfillment Status": "Lost" })]), /Unknown fulfillment/);
});

test("importOrders writes exact values, is idempotent, and dry-run keeps nothing", async () => {
  const { db, client } = await freshDb();
  try {
    const rows = [
      row(),
      row({ "LineItem SKU": "TB-HEGGS-6", "LineItem Qty": "2", "LineItem Sale Price": "$0.00" }),
      row({
        "Order #": "R100000009",
        Subtotal: "$50.00",
        "Shipping Cost": "$18.00",
        Taxes: "$3.01",
        Total: "$71.01",
        "Fulfillment Status": "Cancelled",
        "Payment Status": "Unpaid",
        "Fulfillment Date and Time Stamp": "",
      }),
    ];
    const orders = buildOrders(parseCsv(toCsv(rows)).rows, { catalog: CATALOG, now: NOW });

    const dry = await importOrders(client, orders, { dryRun: true });
    assert.deepEqual(dry.inserted, ["R100000001", "R100000009"]);
    assert.equal(dry.committed, false);
    assert.equal((await client.query("select count(*)::int as n from orders"))[0].n, 0);

    const first = await importOrders(client, orders);
    assert.deepEqual(first, {
      inserted: ["R100000001", "R100000009"],
      skipped: [],
      owner: "pending",
      committed: true,
    });

    const stored = await client.query(
      `select id, owner_user_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created,
              status, method, subtotal::text, shipping::text, tax::text, total::text, history, note, address
         from orders order by id`,
    );
    assert.equal(stored.length, 2);
    assert.deepEqual(
      stored.map((o) => [
        o.id,
        o.owner_user_id,
        o.created,
        o.status,
        o.subtotal,
        o.shipping,
        o.tax,
        o.total,
      ]),
      [
        [
          "R100000001",
          "pending",
          "2025-04-01T15:30:00Z",
          "completed",
          "50.00",
          "18.00",
          "0.00",
          "68.00",
        ],
        [
          "R100000009",
          "pending",
          "2025-04-01T15:30:00Z",
          "cancelled",
          "50.00",
          "18.00",
          "3.01",
          "71.01",
        ],
      ],
    );
    const history = JSON.parse(stored[0].history);
    assert.equal(history[0].at, "2025-04-01T15:30:00.000Z");
    assert.equal(history.at(-1).status, "completed");
    const items = await client.query(
      "select order_id, slug, variant_id, name, label, price::text, qty, sku, kind from order_items order by id",
    );
    assert.deepEqual(
      items.map((i) => [i.order_id, i.slug, i.variant_id, i.sku, i.qty, i.price, i.kind]),
      [
        ["R100000001", "test-breed-eggs", 11, "TB-HEGGS-12", 1, "50.00", "eggs"],
        ["R100000001", "test-breed-eggs", 12, "TB-HEGGS-6", 2, "0.00", "eggs"],
        ["R100000009", "test-breed-eggs", 11, "TB-HEGGS-12", 1, "50.00", "eggs"],
      ],
    );

    const again = await importOrders(client, orders);
    assert.deepEqual(again.inserted, []);
    assert.deepEqual(again.skipped, ["R100000001", "R100000009"]);
    assert.equal((await client.query("select count(*)::int as n from order_items"))[0].n, 3);
  } finally {
    await db.close();
  }
});

test("importOrders owner: claimed desk owner by default, --owner wins, failures roll back", async () => {
  const { db, client } = await freshDb();
  try {
    await client.query("insert into shop_owner (id, user_id) values (1, 'desk-user')");
    const [one] = buildOrders([row({ "Order #": "R1" })], { now: NOW });
    const [two] = buildOrders([row({ "Order #": "R2" })], { now: NOW });
    assert.equal((await importOrders(client, [one])).owner, "desk-user");
    assert.equal(
      (await importOrders(client, [two], { owner: "someone-else" })).owner,
      "someone-else",
    );
    const owners = await client.query("select id, owner_user_id from orders order by id");
    assert.deepEqual(
      owners.map((o) => [o.id, o.owner_user_id]),
      [
        ["R1", "desk-user"],
        ["R2", "someone-else"],
      ],
    );

    const [bad] = buildOrders([row({ "Order #": "R3" })], { now: NOW });
    const broken = { ...bad, method: /** @type {any} */ ("drone") };
    const [good] = buildOrders([row({ "Order #": "R4" })], { now: NOW });
    await assert.rejects(importOrders(client, [good, broken]));
    const ids = (await client.query("select id from orders order by id")).map((r) => r.id);
    assert.deepEqual(ids, ["R1", "R2"], "a failed run leaves no partial import");
  } finally {
    await db.close();
  }
});

test("parseArgs reads the CSV path and flags", () => {
  assert.deepEqual(
    parseArgs(["orders.csv", "--dry-run", "--owner", "u1", "--skip=R1,R2", "--skip", "R3"]),
    {
      file: "orders.csv",
      dryRun: true,
      owner: "u1",
      skip: ["R1", "R2", "R3"],
      json: false,
    },
  );
  assert.throws(() => parseArgs([]), /missing CSV path/);
  assert.throws(() => parseArgs(["a.csv", "--bogus"]), /unknown option/);
  assert.throws(() => parseArgs(["a.csv", "b.csv"]), /only one CSV/);
});

test("CLI dry run without DATABASE_URL uses a throwaway PGlite and prints a JSON summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hh-import-"));
  try {
    const file = join(dir, "orders.csv");
    await writeFile(
      file,
      toCsv([row(), row({ "Order #": "R100000002", "Fulfillment Status": "Cancelled" })]),
    );
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const script = join(here, "import-orders.mjs");
    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", script, file, "--dry-run", "--json", "--skip", "R100000002"],
      { env },
    );
    const report = JSON.parse(stdout);
    assert.equal(report.mode, "dry-run (rolled back)");
    assert.equal(report.orders, 1);
    assert.equal(report.wouldInsert, 1);
    assert.deepEqual(report.skippedByFlag, ["R100000002"]);
    assert.equal(report.totalCents, 6800);

    await assert.rejects(run(process.execPath, [script, file], { env }), (err) => {
      assert.equal(err.code, 2);
      assert.match(err.stderr, /DATABASE_URL is not set/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pickDriver: Neon hosts use the WebSocket driver, others node-postgres, env overrides", () => {
  const neonUrl = "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
  assert.equal(pickDriver(neonUrl, {}), "neon");
  assert.equal(pickDriver("postgres://u:p@localhost:5432/db", {}), "pg");
  assert.equal(pickDriver("postgres://u:p@db.example.com/db", {}), "pg");
  assert.equal(pickDriver("not a url", {}), "pg");
  assert.equal(pickDriver(neonUrl, { IMPORT_DB_DRIVER: "pg" }), "pg");
  assert.equal(pickDriver("postgres://localhost/db", { IMPORT_DB_DRIVER: "NEON" }), "neon");
  assert.throws(() => pickDriver(neonUrl, { IMPORT_DB_DRIVER: "mysql" }), /IMPORT_DB_DRIVER/);
});
