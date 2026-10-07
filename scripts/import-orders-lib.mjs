// @ts-check
/**
 * Pure helpers for the one-time historical order import (GoDaddy Online Store
 * + eBay CSV export -> `orders` / `order_items`). The CLI lives in
 * `scripts/import-orders.mjs`; everything here is side-effect free except
 * `importOrders`, which writes through the small `query` client it is handed.
 *
 * Historical orders are written directly, NOT through `placeShopOrder`, so the
 * original dates, totals, statuses and lines survive exactly as exported: no
 * shipping/tax recalculation, no address rewrite, no line cap, and no "live
 * birds are pickup only" rejection (some old orders predate that rule).
 */

/** Columns the importer reads. A file missing any of them is rejected. */
export const REQUIRED_COLUMNS = [
  "Order #",
  "Email Address",
  "Order Date and Time Stamp",
  "Fulfillment Status",
  "Payment Status",
  "Payment Date and Time Stamp",
  "Fulfillment Date and Time Stamp",
  "Subtotal",
  "Shipping Method",
  "Shipping Cost",
  "Taxes",
  "Total",
  "Billing Name",
  "Shipping Name",
  "Shipping Street Address",
  "Shipping City",
  "Shipping State",
  "Shipping Zip",
  "Sales Channel",
  "LineItem Name",
  "LineItem SKU",
  "LineItem Options",
  "LineItem Qty",
  "LineItem Sale Price",
];

export const PICKUP_METHOD = "In-Person Scheduled Pickup";
export const FARM_PICKUP_ADDRESS = "Farm pickup, Shelbyville, KY 40065";

/**
 * RFC 4180 CSV parser: quoted fields, `""` escapes, embedded commas/newlines,
 * CRLF or LF, and a leading UTF-8 BOM. Returns one object per data row keyed
 * by header name.
 * @param {string} text
 * @returns {{ header: string[], rows: Record<string, string>[] }}
 */
export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let record = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      record.push(field);
      field = "";
      records.push(record);
      record = [];
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ""));
  const [header = [], ...data] = nonEmpty;
  const rows = data.map((r, index) => {
    if (r.length !== header.length) {
      throw new Error(
        `CSV row ${index + 2} has ${r.length} fields; the header has ${header.length}`,
      );
    }
    /** @type {Record<string, string>} */
    const row = {};
    header.forEach((name, col) => {
      row[name] = r[col];
    });
    return row;
  });
  return { header, rows };
}

/**
 * Parse a GoDaddy money cell (`$1,234.50`, `-$30.00`, `$0.00`) into integer
 * cents. Blank cells are 0. Anything else throws so a bad file cannot import
 * silently wrong totals.
 * @param {string | undefined} value
 * @returns {number}
 */
export function parseMoney(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return 0;
  const match = /^(-)?\$?(-)?([0-9][0-9,]*)(?:\.([0-9]{1,2}))?$/.exec(raw);
  if (!match) throw new Error(`Unrecognised money value: ${JSON.stringify(raw)}`);
  const negative = Boolean(match[1] || match[2]);
  const dollars = Number(match[3].replace(/,/g, ""));
  const cents = Number((match[4] ?? "0").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return negative ? -total : total;
}

/**
 * Integer cents -> exact decimal string for a Postgres `numeric` column.
 * @param {number} cents
 */
export function centsToDecimal(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** @param {number} cents */
export function formatDollars(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * GoDaddy stamps look like `2026-06-30 14:54:18 +0000`. Returns an ISO 8601
 * UTC string (`2026-06-30T14:54:18.000Z`), or null for a blank cell. Any
 * offset is honoured, not just +0000.
 * @param {string | undefined} value
 * @returns {string | null}
 */
export function parseTimestamp(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  if (!match) throw new Error(`Unrecognised timestamp: ${JSON.stringify(raw)}`);
  const [, y, mo, d, h, mi, s = "00", zone = "Z"] = match;
  const offset = zone === "Z" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${JSON.stringify(raw)}`);
  return date.toISOString();
}

/**
 * Tracking numbers are exported as Excel formulas (`="9405..."`) so leading
 * zeros survive. Strip that wrapper.
 * @param {string | undefined} value
 */
export function cleanTracking(value) {
  const raw = String(value ?? "").trim();
  const match = /^="(.*)"$/.exec(raw);
  return (match ? match[1] : raw).trim();
}

/**
 * Status mapping (GoDaddy fulfillment + payment -> app status):
 *   payment Refunded            -> cancelled (note says refunded)
 *   fulfillment Cancelled       -> cancelled
 *   fulfillment Fulfilled       -> completed
 *   fulfillment Awaiting Pickup -> ready-for-pickup if Paid, else awaiting-payment
 *   fulfillment Unfulfilled     -> paid if Paid, else awaiting-payment
 * The CSV's payment status is the record; no payment is invented.
 * @param {string} fulfillment
 * @param {string} payment
 * @returns {{ status: import("../src/lib/farm-store").OrderStatus, refunded: boolean }}
 */
export function mapStatus(fulfillment, payment) {
  const f = fulfillment.trim().toLowerCase();
  const p = payment.trim().toLowerCase();
  if (!["paid", "unpaid", "refunded"].includes(p)) {
    throw new Error(`Unknown payment status: ${JSON.stringify(payment)}`);
  }
  const paid = p === "paid";
  if (p === "refunded") {
    if (!["cancelled", "fulfilled", "awaiting pickup", "unfulfilled"].includes(f)) {
      throw new Error(`Unknown fulfillment status: ${JSON.stringify(fulfillment)}`);
    }
    return { status: "cancelled", refunded: true };
  }
  switch (f) {
    case "cancelled":
      return { status: "cancelled", refunded: false };
    case "fulfilled":
      return { status: "completed", refunded: false };
    case "awaiting pickup":
      return { status: paid ? "ready-for-pickup" : "awaiting-payment", refunded: false };
    case "unfulfilled":
      return { status: paid ? "paid" : "awaiting-payment", refunded: false };
    default:
      throw new Error(`Unknown fulfillment status: ${JSON.stringify(fulfillment)}`);
  }
}

/** @param {string} value */
export function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * `Breed Option:Day Old Chick Straight Run` -> `Day Old Chick Straight Run`.
 * Several options are joined with `, `.
 * @param {string | undefined} value
 */
export function optionLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .split(/\s*;\s*/)
    .map((part) => {
      const idx = part.indexOf(":");
      return (idx >= 0 ? part.slice(idx + 1) : part).trim();
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Hatching eggs ship; everything else from this farm is a live bird.
 * @param {{ name: string, sku: string, label: string }} line
 * @returns {"eggs" | "birds"}
 */
export function lineKind({ name, sku, label }) {
  if (/HEGGS/i.test(sku)) return "eggs";
  if (/hatching\s+eggs?/i.test(name) || /hatching\s+eggs?/i.test(label)) return "eggs";
  return "birds";
}

/**
 * @typedef {{ slug: string, name: string, kind: "eggs" | "birds", image?: string,
 *   variants: { id: number | null, sku: string, label: string }[] }} CatalogProduct
 */

/**
 * Product name without parenthesised text (nested too) or pack sizes such as
 * "1 Dozen" / "1/2 Dozen", slugified.
 * @param {string} value
 */
function normName(value) {
  let text = value;
  let prev = "";
  while (prev !== text) {
    prev = text;
    text = text.replace(/\([^()]*\)/g, " ");
  }
  text = text.replace(/\b(?:1\/2|\d+)\s+dozen\b/gi, " ");
  return slugify(text);
}

/** @param {string} sku SKU without punctuation or trailing pack-size digits. */
function skuStem(sku) {
  return sku
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/\d+$/, "");
}

const STOP_WORDS = new Set(["and", "the", "of", "a"]);

/** @param {string} value */
function tokens(value) {
  return new Set(
    normName(value)
      .split("-")
      .filter((t) => t && !STOP_WORDS.has(t)),
  );
}

/**
 * Best-effort match of a historical line to a catalog listing, same kind only
 * except for an exact SKU:
 *   1. exact variant SKU (case-insensitive) -> that product + variant id
 *   2. product name (ignoring parenthesised text and pack sizes; an egg line
 *      named only for the breed also tries "<breed> Hatching Eggs") -> that
 *      product, plus the variant whose label matches, if any
 *   3. same SKU stem (e.g. GDEH6 ~ GDEH12) -> that product, no variant
 *   4. every word of exactly one best product name appears in the line name
 *      (eBay titles like "12+ NPIP/AI BLACK BRESSE ... Hatching Eggs")
 *   5. otherwise a stable slug of the line name (suffixed with the kind if it
 *      would collide with a listing of the other kind) and no variant id.
 * @param {{ name: string, sku: string, label: string, kind: "eggs" | "birds" }} line
 * @param {CatalogProduct[]} catalog
 * @returns {{ slug: string, variantId: number | null, image: string, matched: "sku" | "name" | "sku-stem" | "words" | "none" }}
 */
export function matchCatalog(line, catalog) {
  const sku = line.sku.trim().toLowerCase();
  /** @param {CatalogProduct} product @param {number | null} variantId @param {"sku" | "name" | "sku-stem" | "words"} matched */
  const hit = (product, variantId, matched) => ({
    slug: product.slug,
    variantId,
    image: product.image ?? "",
    matched,
  });
  if (sku) {
    for (const product of catalog) {
      const variant = product.variants.find((v) => v.sku.trim().toLowerCase() === sku);
      if (variant) return hit(product, variant.id ?? null, "sku");
    }
  }
  const sameKind = catalog.filter((p) => p.kind === line.kind);
  const name = normName(line.name);
  const label = line.label.trim().toLowerCase();
  // An egg line named just for the breed ("Black Copper Maran", label "12
  // Hatching Eggs") also matches the "<breed> Hatching Eggs" listing.
  const eggName =
    line.kind === "eggs" && !/hatching/i.test(line.name)
      ? normName(`${line.name} Hatching Eggs`)
      : null;
  const byName = sameKind.filter((p) => normName(p.name) === name || normName(p.name) === eggName);
  if (byName.length > 0) {
    for (const product of byName) {
      const variant = product.variants.find((v) => v.label.trim().toLowerCase() === label);
      if (variant) return hit(product, variant.id ?? null, "name");
    }
    return hit(byName[0], null, "name");
  }
  const stem = skuStem(line.sku);
  if (stem.length >= 3) {
    const byStem = sameKind.filter((p) => p.variants.some((v) => skuStem(v.sku) === stem));
    if (byStem.length === 1) return hit(byStem[0], null, "sku-stem");
  }
  const lineWords = tokens(line.name);
  let best = /** @type {CatalogProduct[]} */ ([]);
  let bestSize = 0;
  for (const product of sameKind) {
    const words = tokens(product.name);
    if (words.size < 2 || ![...words].every((w) => lineWords.has(w))) continue;
    if (words.size > bestSize) {
      best = [product];
      bestSize = words.size;
    } else if (words.size === bestSize) best.push(product);
  }
  if (best.length === 1) return hit(best[0], null, "words");
  let slug = slugify(line.name) || "historical-item";
  if (catalog.some((p) => p.slug === slug && p.kind !== line.kind))
    slug = `${slug}-${line.kind}`.slice(0, 80);
  return { slug, variantId: null, image: "", matched: "none" };
}

/**
 * @param {Record<string, string>} row
 * @param {"Shipping" | "Billing"} prefix
 */
function addressFrom(row, prefix) {
  const street = (row[`${prefix} Street Address`] ?? "").trim();
  if (!street || /^n\/?a$/i.test(street)) return "";
  const street2 = (row[`${prefix} Street Address 2`] ?? "").trim();
  const city = (row[`${prefix} City`] ?? "").trim();
  const state = (row[`${prefix} State`] ?? "").trim();
  const zip = (row[`${prefix} Zip`] ?? "").trim();
  const country = (row[`${prefix} Country`] ?? "").trim();
  const cityLine = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const parts = [street, street2, cityLine];
  if (country && !/^(usa?|united states)$/i.test(country)) parts.push(country);
  return parts.filter(Boolean).join(", ");
}

/**
 * @typedef {{
 *   name: string, sku: string, label: string, qty: number, priceCents: number,
 *   kind: "eggs" | "birds", slug: string, variantId: number | null, image: string,
 *   matched: "sku" | "name" | "sku-stem" | "words" | "none"
 * }} ImportLine
 *
 * @typedef {{
 *   id: string, createdAt: string, customerName: string, customerEmail: string,
 *   customerPhone: string, method: "pickup" | "ship", address: string,
 *   status: import("../src/lib/farm-store").OrderStatus, refunded: boolean,
 *   note: string, subtotalCents: number, shippingCents: number, taxCents: number,
 *   totalCents: number, discountCents: number,
 *   history: { at: string, status: import("../src/lib/farm-store").OrderStatus, note: string }[],
 *   lines: ImportLine[], channel: string, fulfillmentStatus: string,
 *   paymentStatus: string, paidAt: string | null, fulfilledAt: string | null,
 *   oddities: string[]
 * }} ImportOrder
 */

/**
 * Group CSV rows by `Order #` (order-level columns repeat on every line row)
 * and build one import record per order. Row order within an order is kept.
 * @param {Record<string, string>[]} rows
 * @param {{ catalog?: CatalogProduct[], now?: Date }} [options]
 * @returns {ImportOrder[]}
 */
export function buildOrders(rows, options = {}) {
  const catalog = options.catalog ?? [];
  const now = options.now ?? new Date();
  /** @type {Map<string, Record<string, string>[]>} */
  const groups = new Map();
  for (const row of rows) {
    const id = (row["Order #"] ?? "").trim();
    if (!id) throw new Error("A CSV row has no Order #");
    const list = groups.get(id);
    if (list) list.push(row);
    else groups.set(id, [row]);
  }
  return [...groups.entries()].map(([id, group]) => buildOrder(id, group, catalog, now));
}

const ORDER_LEVEL_CHECK = [
  "Order Date and Time Stamp",
  "Total",
  "Fulfillment Status",
  "Payment Status",
  "Email Address",
];

/**
 * @param {string} id
 * @param {Record<string, string>[]} group
 * @param {CatalogProduct[]} catalog
 * @param {Date} now
 * @returns {ImportOrder}
 */
function buildOrder(id, group, catalog, now) {
  const row = group[0];
  /** @type {string[]} */
  const oddities = [];
  for (const col of ORDER_LEVEL_CHECK) {
    if (group.some((r) => (r[col] ?? "") !== (row[col] ?? ""))) {
      oddities.push(`"${col}" differs between this order's line rows (first row used)`);
    }
  }

  const createdAt = parseTimestamp(row["Order Date and Time Stamp"]);
  if (!createdAt) throw new Error(`Order ${id} has no order date`);
  const paidAt = parseTimestamp(row["Payment Date and Time Stamp"]);
  const fulfilledAt = parseTimestamp(row["Fulfillment Date and Time Stamp"]);
  const fulfillmentStatus = row["Fulfillment Status"].trim();
  const paymentStatus = row["Payment Status"].trim();
  const { status, refunded } = mapStatus(fulfillmentStatus, paymentStatus);
  const channel = (row["Sales Channel"] ?? "").trim() || "Online Store";
  const shippingMethod = (row["Shipping Method"] ?? "").trim();
  const method = shippingMethod === PICKUP_METHOD ? "pickup" : "ship";

  const subtotalCents = parseMoney(row["Subtotal"]);
  const shippingCents = parseMoney(row["Shipping Cost"]);
  const taxCents = parseMoney(row["Taxes"]);
  const totalCents = parseMoney(row["Total"]);
  const discountCents = parseMoney(row["Discount"]);

  const shippingAddress = addressFrom(row, "Shipping");
  const billingAddress = addressFrom(row, "Billing");
  let address = shippingAddress || billingAddress;
  if (!address && method === "pickup") address = FARM_PICKUP_ADDRESS;
  if (!address) oddities.push("ship order with no shipping or billing address");

  const shippingName = (row["Shipping Name"] ?? "").trim();
  const billingName = (row["Billing Name"] ?? "").trim();
  const customerName = shippingName || billingName || "(no name in export)";
  if (!shippingName && !billingName) oddities.push("no customer name");
  const customerEmail = (row["Email Address"] ?? "").trim().toLowerCase();
  if (!customerEmail.includes("@")) oddities.push("no customer email");
  const customerPhone = (row["Shipping Phone"] ?? "").trim() || (row["Billing Phone"] ?? "").trim();

  /** @type {ImportLine[]} */
  const lines = group.map((r) => {
    const name = (r["LineItem Name"] ?? "").trim();
    const sku = (r["LineItem SKU"] ?? "").trim();
    const label = optionLabel(r["LineItem Options"]);
    const qty = Number((r["LineItem Qty"] ?? "").trim());
    if (!Number.isInteger(qty) || qty < 1)
      throw new Error(`Order ${id} has a bad quantity: ${r["LineItem Qty"]}`);
    const priceCents = parseMoney(r["LineItem Sale Price"]);
    const kind = lineKind({ name, sku, label });
    const match = matchCatalog({ name, sku, label, kind }, catalog);
    return { name, sku, label, qty, priceCents, kind, ...match };
  });

  // Money cross-checks. Nothing is corrected; mismatches are only flagged.
  const lineSum = lines.reduce((sum, l) => sum + l.priceCents * l.qty, 0);
  if (lineSum !== subtotalCents) {
    oddities.push(
      `line items add up to ${formatDollars(lineSum)} but subtotal is ${formatDollars(subtotalCents)}`,
    );
  }
  const expected = subtotalCents + shippingCents + taxCents + discountCents;
  if (expected !== totalCents) {
    oddities.push(
      `subtotal + shipping + tax + discount = ${formatDollars(expected)} but total is ${formatDollars(totalCents)}`,
    );
  }

  // Note: everything the orders table has no column for.
  const paymentText = (row["Payment Method"] ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("; ");
  const tracking = cleanTracking(row["Tracking #"]);
  const couponCode = (row["Coupon Code"] ?? "").trim();
  const couponName = (row["Coupon Code Name"] ?? "").trim();
  const special = (row["Special Instructions"] ?? "").trim();
  const taxMethod = (row["Tax Method"] ?? "").trim();
  const giftCards = (row["Gift Cards"] ?? "").trim();
  const billingPhone = (row["Billing Phone"] ?? "").trim();
  const noteLines = [
    `Imported from GoDaddy order history. Sales channel: ${channel}. Original order #${id}.`,
  ];
  noteLines.push(`Original statuses: fulfillment ${fulfillmentStatus}, payment ${paymentStatus}.`);
  if (refunded) noteLines.push("Refunded (GoDaddy payment status Refunded).");
  if (paymentText) noteLines.push(`Payment method: ${paymentText}`);
  if (shippingMethod) noteLines.push(`Shipping method: ${shippingMethod}`);
  if (tracking) noteLines.push(`Tracking #: ${tracking}`);
  if (couponCode || couponName) {
    noteLines.push(
      `Coupon: ${[couponCode, couponName && `(${couponName})`].filter(Boolean).join(" ")}`,
    );
  }
  if (discountCents) noteLines.push(`Discount: ${formatDollars(discountCents)}`);
  if (taxMethod) noteLines.push(`Tax method: ${taxMethod}`);
  if (giftCards) noteLines.push(`Gift cards: ${giftCards}`);
  if (special) noteLines.push(`Special instructions: ${special}`);
  const billingDiffers =
    (billingName && billingName !== customerName) ||
    (billingAddress && billingAddress !== address) ||
    (billingPhone && billingPhone !== customerPhone);
  if (billingDiffers) {
    const billing = [billingName, billingAddress, billingPhone].filter(Boolean).join(", ");
    noteLines.push(`Billing: ${billing}`);
  }
  const note = noteLines.join("\n");

  // History: original GoDaddy timestamps, ending on the mapped status.
  /** @type {ImportOrder["history"]} */
  const history = [
    {
      at: createdAt,
      status: "awaiting-payment",
      note: `Order placed on ${channel} (GoDaddy order #${id}).`,
    },
  ];
  if (paidAt && (paymentStatus.toLowerCase() === "paid" || refunded)) {
    history.push({
      at: paidAt,
      status: "paid",
      note: `GoDaddy payment recorded${paymentText ? `: ${paymentText}` : ""}.`,
    });
  }
  if (fulfilledAt) {
    history.push({
      at: fulfilledAt,
      status: fulfillmentStatus.toLowerCase() === "cancelled" ? "cancelled" : "completed",
      note: `GoDaddy fulfillment status ${fulfillmentStatus}${tracking ? ` (tracking ${tracking})` : ""}.`,
    });
  }
  const lastAt = history.reduce((max, h) => (h.at > max ? h.at : max), createdAt);
  history.push({
    at: lastAt,
    status,
    note:
      `Imported from GoDaddy: fulfillment ${fulfillmentStatus}, payment ${paymentStatus}` +
      `${paidAt ? `, paid ${paidAt}` : ""}${fulfilledAt ? `, fulfilled ${fulfilledAt}` : ""}` +
      `${refunded ? ". Refunded" : ""}.`,
  });

  // Oddities worth a human look.
  const ageDays = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000);
  const f = fulfillmentStatus.toLowerCase();
  const p = paymentStatus.toLowerCase();
  if (/test/i.test(id)) oddities.push("looks like a test order (order # contains TEST)");
  if ((f === "awaiting pickup" || f === "unfulfilled") && p !== "refunded" && ageDays > 30) {
    oddities.push(`still "${fulfillmentStatus}" (${p}) after ${ageDays} days`);
  }
  if (f === "fulfilled" && p === "unpaid") oddities.push("fulfilled but payment status Unpaid");
  if (f === "cancelled" && p === "paid")
    oddities.push("cancelled but payment status Paid (no refund recorded)");
  if (refunded && f !== "cancelled")
    oddities.push(`refunded while fulfillment was "${fulfillmentStatus}"; imported as cancelled`);
  if (p === "paid" && totalCents === 0) {
    oddities.push("$0 total (coupon covered the whole order), so no payment on record");
  } else {
    if (p === "paid" && !paidAt) oddities.push("paid but no payment timestamp");
    if (p === "paid" && !paymentText && channel !== "eBay")
      oddities.push("paid but no payment method recorded");
  }
  if (method === "ship" && lines.some((l) => l.kind === "birds")) {
    oddities.push(
      `shipped order contains live birds: ${lines
        .filter((l) => l.kind === "birds")
        .map((l) => l.name)
        .join(", ")}`,
    );
  }
  if (method === "pickup" && shippingAddress)
    oddities.push("pickup order that also has a shipping address");
  if (
    method === "ship" &&
    f === "fulfilled" &&
    !tracking &&
    channel !== "eBay" &&
    shippingCents > 0
  ) {
    oddities.push("shipped and fulfilled with no tracking number");
  }
  const shipCountry = (row["Shipping Country"] ?? "").trim();
  if (method === "ship" && shipCountry && !/^usa?$/i.test(shipCountry))
    oddities.push(`ships to country code ${shipCountry}`);

  return {
    id,
    createdAt,
    customerName,
    customerEmail,
    customerPhone,
    method,
    address,
    status,
    refunded,
    note,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
    discountCents,
    history,
    lines,
    channel,
    fulfillmentStatus,
    paymentStatus,
    paidAt,
    fulfilledAt,
    oddities,
  };
}

/**
 * Minimal client surface: node-postgres `Client`/`PoolClient` and PGlite both
 * fit once wrapped as `(text, params) => rows`.
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<Record<string, any>[]> }} QueryClient
 */

/**
 * Write orders inside ONE transaction. Orders whose id already exists are
 * skipped (idempotent re-runs). With `dryRun` the transaction is rolled back,
 * so schema constraints are still exercised but nothing is kept.
 * @param {QueryClient} client
 * @param {ImportOrder[]} orders
 * @param {{ owner?: string | null, dryRun?: boolean }} [options]
 * @returns {Promise<{ inserted: string[], skipped: string[], owner: string, committed: boolean }>}
 */
export async function importOrders(client, orders, options = {}) {
  const dryRun = Boolean(options.dryRun);
  await client.query("begin");
  try {
    // Mirror placeShopOrder: if the desk is already claimed, attach to that
    // owner; otherwise 'pending', which claimDesk reassigns.
    /** @type {string} */
    const owner =
      options.owner ||
      String(
        (await client.query("select user_id from shop_owner where id = 1"))[0]?.user_id ??
          "pending",
      );
    const ids = orders.map((o) => o.id);
    const existing = new Set(
      (await client.query("select id from orders where id = any($1::text[])", [ids])).map((r) =>
        String(r.id),
      ),
    );
    /** @type {string[]} */
    const inserted = [];
    /** @type {string[]} */
    const skipped = [];
    for (const order of orders) {
      if (existing.has(order.id)) {
        skipped.push(order.id);
        continue;
      }
      const result = await client.query(
        `insert into orders (
           id, owner_user_id, created_at, customer_name, customer_email, customer_phone,
           method, address, status, note, subtotal, shipping, tax, total, history
         ) values ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10,
                   $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15)
         on conflict (id) do nothing
         returning id`,
        [
          order.id,
          owner,
          order.createdAt,
          order.customerName,
          order.customerEmail,
          order.customerPhone,
          order.method,
          order.address,
          order.status,
          order.note,
          centsToDecimal(order.subtotalCents),
          centsToDecimal(order.shippingCents),
          centsToDecimal(order.taxCents),
          centsToDecimal(order.totalCents),
          JSON.stringify(order.history),
        ],
      );
      if (result.length === 0) {
        skipped.push(order.id);
        continue;
      }
      for (const line of order.lines) {
        await client.query(
          `insert into order_items (order_id, slug, variant_id, name, label, price, image, qty, sku, kind)
           values ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10)`,
          [
            order.id,
            line.slug,
            line.variantId,
            line.name,
            line.label,
            centsToDecimal(line.priceCents),
            line.image,
            line.qty,
            line.sku,
            line.kind,
          ],
        );
      }
      inserted.push(order.id);
    }
    await client.query(dryRun ? "rollback" : "commit");
    return { inserted, skipped, owner, committed: !dryRun };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // Connection gone; keep the original error.
    }
    throw err;
  }
}

/**
 * Aggregate numbers for the dry-run / post-run report. Contains order numbers
 * and product names only, never customer details.
 * @param {ImportOrder[]} orders
 */
export function summarize(orders) {
  /** @param {(o: ImportOrder) => string} key */
  const count = (key) => {
    /** @type {Record<string, number>} */
    const out = {};
    for (const o of orders) out[key(o)] = (out[key(o)] ?? 0) + 1;
    return out;
  };
  const dates = orders.map((o) => o.createdAt).sort();
  const lines = orders.flatMap((o) => o.lines);
  /** @type {Record<string, number>} */
  const kinds = {};
  /** @type {Record<string, number>} */
  const matched = {};
  for (const l of lines) {
    kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
    matched[l.matched] = (matched[l.matched] ?? 0) + 1;
  }
  const sum = (/** @type {(o: ImportOrder) => number} */ f) => orders.reduce((s, o) => s + f(o), 0);
  return {
    orders: orders.length,
    lines: lines.length,
    firstOrder: dates[0] ?? null,
    lastOrder: dates[dates.length - 1] ?? null,
    statuses: count((o) => o.status),
    original: count((o) => `${o.fulfillmentStatus} / ${o.paymentStatus}`),
    channels: count((o) => o.channel),
    methods: count((o) => o.method),
    lineKinds: kinds,
    catalogMatch: matched,
    totalCents: sum((o) => o.totalCents),
    subtotalCents: sum((o) => o.subtotalCents),
    shippingCents: sum((o) => o.shippingCents),
    taxCents: sum((o) => o.taxCents),
    discountCents: sum((o) => o.discountCents),
    nonCancelledTotalCents: sum((o) => (o.status === "cancelled" ? 0 : o.totalCents)),
    longestNote: orders.reduce((m, o) => Math.max(m, o.note.length), 0),
    notesOver500: orders.filter((o) => o.note.length > 500).length,
    oddities: orders
      .filter((o) => o.oddities.length > 0)
      .map((o) => ({
        id: o.id,
        date: o.createdAt.slice(0, 10),
        status: o.status,
        issues: o.oddities,
      })),
  };
}
