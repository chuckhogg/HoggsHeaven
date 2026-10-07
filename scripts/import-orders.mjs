#!/usr/bin/env node
// @ts-check
/**
 * One-time import of historical GoDaddy Online Store + eBay orders into the
 * store database (`orders` / `order_items`).
 *
 *   DATABASE_URL=postgres://... npm run import:orders -- /path/to/orders.csv --dry-run
 *   DATABASE_URL=postgres://... npm run import:orders -- /path/to/orders.csv
 *
 * Options:
 *   --dry-run         run every insert inside a transaction, print the summary,
 *                     then ROLL BACK (nothing is kept)
 *   --owner <userId>  owner_user_id for the imported orders. Default: the
 *                     claimed desk owner if there is one, else 'pending'
 *                     (claimDesk reassigns 'pending' orders)
 *   --skip <ids>      comma-separated order numbers to leave out
 *   --json            print the summary as JSON
 *
 * Without DATABASE_URL only --dry-run is allowed; it runs against a throwaway
 * in-memory PGlite database with migrations/*.sql applied.
 *
 * The CSV holds customer details. Keep it out of the repo; pass its path here.
 * It must not contain card data, and this script never reads or stores any.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_COLUMNS,
  buildOrders,
  formatDollars,
  importOrders,
  parseCsv,
  summarize,
} from "./import-orders-lib.mjs";
import { pendingMigrations } from "./migration-plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE =
  "usage: npm run import:orders -- <orders.csv> [--dry-run] [--owner <userId>] [--skip R123,R456] [--json]";

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ file: string | null, dryRun: boolean, owner: string | null, skip: string[], json: boolean }} */
  const args = { file: null, dryRun: false, owner: null, skip: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--owner" || arg.startsWith("--owner=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
      if (!value) throw new Error("--owner needs a user id");
      args.owner = value.trim();
    } else if (arg === "--skip" || arg.startsWith("--skip=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
      if (!value) throw new Error("--skip needs order numbers");
      args.skip.push(
        ...value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else if (args.file) throw new Error("only one CSV path is accepted");
    else args.file = arg;
  }
  if (!args.file) throw new Error("missing CSV path");
  return { ...args, file: args.file };
}

/**
 * @returns {Promise<{ client: import("./import-orders-lib.mjs").QueryClient, label: string, close: () => Promise<void> }>}
 */
async function openDatabase() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return {
      client: { query: async (text, params) => (await client.query(text, params)).rows },
      label: "DATABASE_URL",
      close: () => client.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.waitReady;
  const dir = join(root, "migrations");
  for (const { name } of pendingMigrations(await readdir(dir), [])) {
    await db.exec(await readFile(join(dir, name), "utf8"));
  }
  return {
    client: { query: async (text, params) => (await db.query(text, params)).rows },
    label: "in-memory PGlite (throwaway)",
    close: () => db.close(),
  };
}

/**
 * Catalog for slug/variant matching. Prefer the database's own listings (their
 * serial ids are what order_items.variant_id points at). If the store has not
 * been seeded yet, fall back to src/lib/catalog.ts for slugs only.
 * @param {import("./import-orders-lib.mjs").QueryClient} client
 * @returns {Promise<{ catalog: import("./import-orders-lib.mjs").CatalogProduct[], source: string }>}
 */
async function loadCatalog(client) {
  const products = await client.query(
    "select id, slug, name, kind, image from products order by id",
  );
  if (products.length > 0) {
    const variants = await client.query(
      "select id, product_id, sku, label from variants order by id",
    );
    return {
      source: "database listings",
      catalog: products.map((p) => ({
        slug: p.slug,
        name: p.name,
        kind: p.kind,
        image: p.image,
        variants: variants
          .filter((v) => v.product_id === p.id)
          .map((v) => ({ id: Number(v.id), sku: v.sku, label: v.label })),
      })),
    };
  }
  try {
    const mod = await import("../src/lib/catalog.ts");
    return {
      source: "src/lib/catalog.ts (store not seeded yet; variant ids left empty)",
      catalog: mod.products.map((/** @type {any} */ p) => ({
        slug: p.slug,
        name: p.name,
        kind: p.kind,
        image: p.image,
        variants: p.variants.map((/** @type {any} */ v) => ({
          id: null,
          sku: v.sku,
          label: v.label,
        })),
      })),
    };
  } catch (err) {
    return {
      source: `none (${/** @type {Error} */ (err).message}); slugs derived from names`,
      catalog: [],
    };
  }
}

/** @param {Record<string, number>} counts */
function fmtCounts(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[import] ${/** @type {Error} */ (err).message}\n${USAGE}`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL?.trim() && !args.dryRun) {
    console.error(
      "[import] DATABASE_URL is not set. Set it to the store database, or pass --dry-run.",
    );
    process.exit(2);
  }

  const { header, rows } = parseCsv(await readFile(args.file, "utf8"));
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.join(", ")}`);
  const cardish = header.filter((h) => /card\s*(number|no)|cvv|cvc|security code|expir/i.test(h));
  if (cardish.length) {
    throw new Error(
      `CSV has card-data columns (${cardish.join(", ")}). Remove them; card data is never imported.`,
    );
  }

  const db = await openDatabase();
  try {
    const { catalog, source } = await loadCatalog(db.client);
    const skip = new Set(args.skip);
    const all = buildOrders(rows, { catalog });
    const orders = all.filter((o) => !skip.has(o.id));
    const unknownSkips = [...skip].filter((id) => !all.some((o) => o.id === id));
    const result = await importOrders(db.client, orders, {
      owner: args.owner,
      dryRun: args.dryRun,
    });
    const summary = summarize(orders);
    const report = {
      mode: args.dryRun ? "dry-run (rolled back)" : "import (committed)",
      database: db.label,
      catalog: source,
      csvRows: rows.length,
      owner: result.owner,
      wouldInsert: result.inserted.length,
      alreadyImported: result.skipped.length,
      skippedByFlag:
        orders.length === all.length ? [] : all.filter((o) => skip.has(o.id)).map((o) => o.id),
      unknownSkips,
      ...summary,
    };
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const verb = args.dryRun ? "would insert" : "inserted";
    console.log(`[import] ${report.mode} against ${report.database}`);
    console.log(`[import] catalog: ${report.catalog}`);
    console.log(
      `[import] CSV rows: ${report.csvRows}; orders: ${summary.orders}; line items: ${summary.lines}`,
    );
    console.log(
      `[import] ${verb}: ${result.inserted.length}; already imported (skipped): ${result.skipped.length}`,
    );
    if (report.skippedByFlag.length)
      console.log(`[import] left out via --skip: ${report.skippedByFlag.join(", ")}`);
    if (unknownSkips.length)
      console.log(`[import] --skip ids not in the CSV: ${unknownSkips.join(", ")}`);
    console.log(`[import] owner_user_id: ${result.owner}`);
    console.log(`[import] dates: ${summary.firstOrder} .. ${summary.lastOrder}`);
    console.log(`[import] statuses: ${fmtCounts(summary.statuses)}`);
    console.log(`[import] original GoDaddy statuses: ${fmtCounts(summary.original)}`);
    console.log(
      `[import] channels: ${fmtCounts(summary.channels)}; methods: ${fmtCounts(summary.methods)}`,
    );
    console.log(
      `[import] line kinds: ${fmtCounts(summary.lineKinds)}; catalog match: ${fmtCounts(summary.catalogMatch)}`,
    );
    console.log(
      `[import] money: total ${formatDollars(summary.totalCents)} (excluding cancelled ${formatDollars(summary.nonCancelledTotalCents)}); ` +
        `subtotal ${formatDollars(summary.subtotalCents)}, shipping ${formatDollars(summary.shippingCents)}, ` +
        `tax ${formatDollars(summary.taxCents)}, discounts ${formatDollars(summary.discountCents)}`,
    );
    console.log(
      `[import] longest note: ${summary.longestNote} chars; notes over 500 chars: ${summary.notesOver500}`,
    );
    console.log(`[import] flagged orders: ${summary.oddities.length}`);
    for (const o of summary.oddities)
      console.log(`  ${o.id} (${o.date}, ${o.status}): ${o.issues.join("; ")}`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[import] failed:", err?.message || err);
    for (const key of ["code", "detail", "hint", "constraint"]) {
      if (err?.[key] != null) console.error(`[import]   ${key}: ${err[key]}`);
    }
    process.exit(1);
  });
}
