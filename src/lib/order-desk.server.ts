/**
 * Farm desk order reads and edits (server-only, but free of path aliases and
 * framework imports so the node tests run the real queries on PGLite).
 *
 * `shop.functions.ts` wraps these in owner-checked server functions.
 *
 * Edit rules (unchanged from the old edit form, now enforced per field):
 * - An update is a PATCH: only the fields the desk sent are validated and
 *   written. Everything else stays exactly as stored, so an imported order's
 *   long note, empty phone or odd line label is never trimmed or rewritten
 *   just because the farm changed its status.
 * - Stored subtotal / shipping / tax / total are history. They only move when
 *   the lines or the shipping method actually change (see `planOrderEdit`).
 * - The stored address is never replaced by a generated one; a blank address
 *   keeps the stored one.
 * - A status change appends a history entry automatically.
 */
import type { Sql } from "./db";
import type { Order, OrderStatus } from "./farm-store";
import {
  PICKUP_ADDRESS,
  planOrderEdit,
  roundMoney,
  sortMethods,
  subtotalOf,
  type ShippingMethod,
} from "./shipping.ts";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "awaiting-payment",
  "paid",
  "packing",
  "shipped",
  "ready-for-pickup",
  "completed",
  "cancelled",
];

export const LIMITS = { name: 80, email: 120, phone: 30, address: 300, note: 8000, statusNote: 300, lines: 50 } as const;

/** A desk-side order line as the browser sends it. */
export type DeskLineInput = {
  name?: string;
  label?: string;
  price?: number | string;
  qty?: number | string;
  sku?: string;
  image?: string;
  kind?: string;
  slug?: string;
  variantId?: number | null;
};

export type DeskLine = {
  name: string;
  label: string;
  price: number;
  qty: number;
  sku: string;
  image: string;
  kind: "eggs" | "birds";
  slug: string;
  variantId: number | null;
};

/** Fields the desk may change on an existing order. Omitted = keep as stored. */
export type OrderPatch = {
  name?: string;
  email?: string;
  phone?: string;
  /** "pickup", a shipping method slug, or "legacy-ship" (keep an older order's unrecorded method). */
  shipping?: string;
  address?: string;
  status?: OrderStatus;
  /** Optional note for the history entry a status change adds. */
  statusNote?: string;
  note?: string;
  items?: DeskLine[];
};

export type NewOrderInput = {
  name: string;
  email: string;
  phone: string;
  shipping: string;
  address: string;
  status: OrderStatus;
  note: string;
  items: DeskLine[];
};

function str(value: unknown) {
  return String(value ?? "").trim();
}

function limited(value: unknown, max: number, label: string) {
  const out = str(value);
  if (out.length > max) throw new Error(`${label} is too long (${max} characters at most).`);
  return out;
}

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error("Enter a valid price.");
  return Math.round(n * 100) / 100;
}

export function parseStatus(value: unknown): OrderStatus {
  if (ORDER_STATUSES.includes(value as OrderStatus)) return value as OrderStatus;
  throw new Error("Pick a valid status.");
}

/** Normalize one order line. Stored lines go through the same function so comparisons are fair. */
export function deskLine(item: DeskLineInput): DeskLine {
  const name = str(item?.name).slice(0, 120);
  const qty = Math.floor(Number(item?.qty));
  if (!Number.isFinite(qty) || qty < 1 || qty > 999) throw new Error(`Quantity for ${name || "a line"} must be 1 to 999.`);
  const variant = item?.variantId == null || item.variantId === ("" as unknown) ? null : Number(item.variantId);
  return {
    name,
    label: str(item?.label).slice(0, 80) || name.slice(0, 80) || "Custom",
    price: money(item?.price),
    qty,
    sku: str(item?.sku).slice(0, 40),
    image: str(item?.image).slice(0, 500),
    kind: item?.kind === "birds" ? "birds" : "eggs",
    slug: str(item?.slug).slice(0, 80) || "custom",
    variantId: variant != null && Number.isInteger(variant) && variant > 0 ? variant : null,
  };
}

/** A stored line, normalized like `deskLine` but never rejected (old rows may predate today's limits). */
export function storedLine(item: ItemRow): DeskLine {
  const name = str(item.name).slice(0, 120);
  return {
    name,
    label: str(item.label).slice(0, 80) || name.slice(0, 80) || "Custom",
    price: Math.round(Number(item.price) * 100) / 100,
    qty: Number(item.qty),
    sku: str(item.sku).slice(0, 40),
    image: str(item.image).slice(0, 500),
    kind: item.kind === "birds" ? "birds" : "eggs",
    slug: str(item.slug).slice(0, 80) || "custom",
    variantId: item.variant_id ?? null,
  };
}

function lines(input: unknown): DeskLine[] {
  if (!Array.isArray(input)) throw new Error("Lines must be a list.");
  if (input.length > LIMITS.lines) throw new Error(`An order can have at most ${LIMITS.lines} lines.`);
  const out = input.map((item) => deskLine(item as DeskLineInput));
  if (out.length === 0 || out.some((item) => !item.name)) throw new Error("Each order needs at least one named line.");
  return out;
}

function email(value: unknown) {
  const out = limited(value, LIMITS.email, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(out)) throw new Error("Enter a valid email.");
  return out;
}

function name(value: unknown) {
  const out = limited(value, LIMITS.name, "Name");
  if (!out) throw new Error("Name is required.");
  return out;
}

/** Validate a partial update from the browser. Only keys that are present are checked. */
export function parseOrderPatch(input: unknown): OrderPatch {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;
  const patch: OrderPatch = {};
  if (has("name")) patch.name = name(raw.name);
  if (has("email")) patch.email = email(raw.email);
  if (has("phone")) patch.phone = limited(raw.phone, LIMITS.phone, "Phone");
  if (has("shipping")) {
    const choice = limited(raw.shipping, 60, "Shipping method");
    if (!choice) throw new Error("Pick farm pickup or a shipping method.");
    patch.shipping = choice;
  }
  if (has("address")) patch.address = limited(raw.address, LIMITS.address, "Address");
  if (has("status")) patch.status = parseStatus(raw.status);
  if (has("statusNote")) patch.statusNote = limited(raw.statusNote, LIMITS.statusNote, "Status note");
  if (has("note")) patch.note = limited(raw.note, LIMITS.note, "Notes");
  if (has("items")) patch.items = lines(raw.items);
  return patch;
}

export function parseNewOrder(input: unknown): NewOrderInput {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    name: name(raw.name),
    email: email(raw.email),
    phone: limited(raw.phone, LIMITS.phone, "Phone"),
    shipping: str(raw.shipping) || "pickup",
    address: limited(raw.address, LIMITS.address, "Address"),
    status: raw.status == null || raw.status === "" ? "awaiting-payment" : parseStatus(raw.status),
    note: limited(raw.note, LIMITS.note, "Notes"),
    items: lines(raw.items),
  };
}

// ---------------------------------------------------------------------------
// Reads

type MethodRow = { slug: string; carrier: string; name: string; price: number | null; active: boolean; sort_order: number; notes: string };

export async function readShippingMethods(sql: Sql, withNotes = false): Promise<ShippingMethod[]> {
  const rows = await sql<MethodRow>`
    select slug, carrier, name, price::float8 as price, active, sort_order, notes from shipping_methods
  `;
  return sortMethods(
    rows.map((row) => ({
      slug: row.slug,
      carrier: row.carrier,
      name: row.name,
      price: row.price == null ? null : Number(row.price),
      active: Boolean(row.active),
      sortOrder: Number(row.sort_order),
      ...(withNotes ? { notes: row.notes } : {}),
    })),
  );
}

export async function readTaxRate(sql: Sql): Promise<number> {
  const rows = await sql<{ tax_rate: number }>`select tax_rate::float8 as tax_rate from shop_settings where id = 1`;
  return Number(rows[0]?.tax_rate ?? 0);
}

export type OrderRow = {
  id: string;
  created_at: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  method: "pickup" | "ship";
  shipping_method: string | null;
  shipping_method_name: string | null;
  address: string;
  status: OrderStatus;
  note: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  history: string;
};

export type ItemRow = {
  order_id: string;
  slug: string;
  variant_id: number | null;
  name: string;
  label: string;
  price: number;
  image: string;
  qty: number;
  sku: string;
  kind: "eggs" | "birds";
};

export const ORDER_SELECT = `
  id,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
  customer_name, customer_email, customer_phone, method, shipping_method, shipping_method_name, address, status, note,
  subtotal::float8 as subtotal, shipping::float8 as shipping, tax::float8 as tax, total::float8 as total,
  history
`;

export const ITEM_SELECT = `order_id, slug, variant_id, name, label, price::float8 as price, image, qty, sku, kind`;

export function parseHistory(raw: string): Order["history"] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Order["history"]) : [];
  } catch {
    return [];
  }
}

export function packOrders(rows: OrderRow[], items: ItemRow[]): Order[] {
  return rows.map((row) => ({
    id: row.id,
    created: row.created_at,
    customer: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    method: row.method,
    shippingMethod: row.shipping_method ? { slug: row.shipping_method, name: row.shipping_method_name ?? row.shipping_method } : null,
    address: row.address,
    payment: { type: "pay-at-pickup" },
    status: row.status,
    history: parseHistory(row.history),
    note: row.note,
    totals: { sub: Number(row.subtotal), ship: Number(row.shipping), tax: Number(row.tax), total: Number(row.total) },
    items: items
      .filter((item) => item.order_id === row.id)
      .map((item) => ({
        key: `${item.slug}:${item.variant_id ?? item.sku}`,
        slug: item.slug,
        variantId: item.variant_id ?? 0,
        name: item.name,
        label: item.label,
        price: Number(item.price),
        image: item.image,
        qty: Number(item.qty),
        sku: item.sku,
        kind: item.kind,
      })),
  }));
}

export async function listDeskOrders(sql: Sql, ownerId: string): Promise<Order[]> {
  const rows = await sql.query<OrderRow>(
    `select ${ORDER_SELECT} from orders where owner_user_id = $1 order by created_at desc, id desc`,
    [ownerId],
  );
  const items = await sql.query<ItemRow>(
    `select oi.order_id, oi.slug, oi.variant_id, oi.name, oi.label, oi.price::float8 as price, oi.image, oi.qty, oi.sku, oi.kind
     from order_items oi join orders o on o.id = oi.order_id
     where o.owner_user_id = $1 order by oi.id`,
    [ownerId],
  );
  return packOrders(rows, items);
}

export async function readDeskOrder(sql: Sql, ownerId: string, id: string): Promise<Order | null> {
  const rows = await sql.query<OrderRow>(`select ${ORDER_SELECT} from orders where id = $1 and owner_user_id = $2`, [id, ownerId]);
  if (!rows[0]) return null;
  const items = await sql.query<ItemRow>(`select ${ITEM_SELECT} from order_items where order_id = $1 order by id`, [id]);
  return packOrders(rows, items)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Writes

type ChosenMethod = { method: "pickup" | "ship"; shippingMethod: ShippingMethod | null; legacy: boolean };

function resolveMethod(choice: string, methods: ShippingMethod[]): ChosenMethod {
  if (choice === "pickup") return { method: "pickup", shippingMethod: null, legacy: false };
  if (choice === "legacy-ship") return { method: "ship", shippingMethod: null, legacy: true };
  const found = methods.find((method) => method.slug === choice);
  if (!found) throw new Error("That shipping method no longer exists.");
  return { method: "ship", shippingMethod: found, legacy: false };
}

/** A newly chosen method must be allowed by every listing on the order (custom lines are up to the farm). */
async function checkMethodFitsLines(sql: Sql, method: ShippingMethod, items: DeskLine[]) {
  const slugs = [...new Set(items.map((item) => item.slug))];
  if (slugs.length === 0) return;
  const products = await sql.query<{ slug: string; name: string; allowed: boolean }>(
    `select p.slug, p.name,
       exists (select 1 from product_shipping_methods m where m.product_id = p.id and m.method_slug = $2) as allowed
     from products p where p.slug = any($1::text[])`,
    [slugs, method.slug],
  );
  const blocked = products.find((product) => !product.allowed);
  if (blocked) throw new Error(`${blocked.name} doesn't ship by ${method.name}. Allow it on the listing or pick another method.`);
}

async function writeLines(sql: Sql, id: string, items: DeskLine[]) {
  for (const item of items) {
    await sql`
      insert into order_items (order_id, slug, variant_id, name, label, price, image, qty, sku, kind)
      values (${id}, ${item.slug}, ${item.variantId}, ${item.name}, ${item.label}, ${item.price}, ${item.image}, ${item.qty}, ${item.sku}, ${item.kind})
    `;
  }
}

export type UpdateResult = { order: Order; changed: string[] };

/**
 * Apply a partial edit to one of the owner's orders and return the stored result.
 * `changed` lists the columns that actually changed ([] = nothing to save).
 */
export async function updateDeskOrder(
  sql: Sql,
  ownerId: string,
  id: string,
  patch: OrderPatch,
  options: { now?: Date } = {},
): Promise<UpdateResult> {
  const rows = await sql.query<OrderRow>(`select ${ORDER_SELECT} from orders where id = $1 and owner_user_id = $2`, [id, ownerId]);
  const row = rows[0];
  if (!row) throw new Error("That order is not on this desk.");
  const storedItems = await sql.query<ItemRow>(`select ${ITEM_SELECT} from order_items where order_id = $1 order by id`, [id]);
  const stored = storedItems.map(storedLine);

  const changed: string[] = [];
  const set: Record<string, unknown> = {};
  const assign = (column: string, next: unknown, current: unknown) => {
    if (next === undefined || next === current) return;
    set[column] = next;
    changed.push(column);
  };
  assign("customer_name", patch.name, row.customer_name);
  assign("customer_email", patch.email, row.customer_email);
  assign("customer_phone", patch.phone, row.customer_phone);
  assign("note", patch.note, row.note);

  // Method, address, lines and totals.
  const storedChoice = row.method === "pickup" ? "pickup" : row.shipping_method ?? "legacy-ship";
  const choice = patch.shipping ?? storedChoice;
  const touchesMoney = patch.shipping !== undefined || patch.items !== undefined || patch.address !== undefined;
  let itemsChanged = false;
  if (touchesMoney) {
    const methods = await readShippingMethods(sql);
    // An order whose stored method was since deleted keeps it as long as the desk doesn't change it.
    const resolved =
      choice === storedChoice && row.shipping_method && !methods.some((method) => method.slug === row.shipping_method)
        ? { method: row.method, shippingMethod: null, legacy: false }
        : resolveMethod(choice, methods);
    const items = patch.items ?? stored;
    const plan = planOrderEdit(
      {
        method: row.method,
        shippingMethod: row.shipping_method,
        address: row.address,
        subtotal: Number(row.subtotal),
        shipping: Number(row.shipping),
        tax: Number(row.tax),
        total: Number(row.total),
        items: stored,
      },
      {
        method: resolved.method,
        shippingMethod: choice === storedChoice ? row.shipping_method : resolved.shippingMethod?.slug ?? null,
        address: patch.address ?? "",
        items,
      },
      {
        taxRate: await readTaxRate(sql),
        newShipping: resolved.shippingMethod ? resolved.shippingMethod.price : resolved.method === "pickup" ? 0 : null,
      },
    );
    if (plan.methodChanged && resolved.shippingMethod) await checkMethodFitsLines(sql, resolved.shippingMethod, items);
    if (plan.methodChanged) {
      assign("method", resolved.method, row.method);
      assign("shipping_method", resolved.shippingMethod?.slug ?? null, row.shipping_method);
      assign("shipping_method_name", resolved.shippingMethod?.name ?? null, row.shipping_method_name);
    }
    assign("address", plan.address, row.address);
    assign("subtotal", plan.subtotal, Number(row.subtotal));
    assign("shipping", plan.shipping, Number(row.shipping));
    assign("tax", plan.tax, Number(row.tax));
    assign("total", plan.total, Number(row.total));
    itemsChanged = plan.itemsChanged;
    if (itemsChanged) changed.push("items");
  }

  if (patch.status !== undefined && patch.status !== row.status) {
    const history = parseHistory(row.history);
    history.push({
      at: (options.now ?? new Date()).toISOString(),
      status: patch.status,
      note: patch.statusNote || "Status changed on the farm desk.",
    });
    set.status = patch.status;
    set.history = JSON.stringify(history);
    changed.push("status");
  }

  const columns = Object.keys(set);
  if (columns.length > 0) {
    const assignments = columns.map((column, index) => `${column} = $${index + 3}`).join(", ");
    await sql.query(`update orders set ${assignments} where id = $1 and owner_user_id = $2`, [id, ownerId, ...columns.map((c) => set[c])]);
  }
  if (itemsChanged && patch.items) {
    await sql`delete from order_items where order_id = ${id}`;
    await writeLines(sql, id, patch.items);
  }
  const order = await readDeskOrder(sql, ownerId, id);
  if (!order) throw new Error("That order is not on this desk.");
  return { order, changed: changed.filter((c) => c !== "history") };
}

export function newOrderId(now = new Date()) {
  const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let tail = "";
  for (const byte of bytes) tail += alphabet[byte % alphabet.length];
  return `HH-${stamp}-${tail}`;
}

/** Add an order from the farm desk (totals at today's rates). */
export async function createDeskOrder(sql: Sql, ownerId: string, input: NewOrderInput, options: { now?: Date } = {}): Promise<Order> {
  const methods = await readShippingMethods(sql);
  if (input.shipping === "legacy-ship") throw new Error("Pick a shipping method for a shipped order.");
  const resolved = resolveMethod(input.shipping, methods);
  const chosen = resolved.shippingMethod;
  if (chosen && chosen.price == null) throw new Error(`Set a price for ${chosen.name} under Shipping first.`);
  if (chosen) await checkMethodFitsLines(sql, chosen, input.items);
  const sub = subtotalOf(input.items);
  const ship = chosen?.price ?? 0;
  const tax = roundMoney(sub * (await readTaxRate(sql)));
  const total = roundMoney(sub + ship + tax);
  const address = input.address || (resolved.method === "pickup" ? PICKUP_ADDRESS : "");
  if (resolved.method === "ship" && address.length < 5) throw new Error("Add a shipping address.");
  const now = options.now ?? new Date();
  const id = newOrderId(now);
  const history = JSON.stringify([{ at: now.toISOString(), status: input.status, note: "Added from the farm desk." }]);
  await sql`
    insert into orders (
      id, owner_user_id, customer_name, customer_email, customer_phone, method, shipping_method, shipping_method_name,
      address, status, note, subtotal, shipping, tax, total, history
    ) values (
      ${id}, ${ownerId}, ${input.name}, ${input.email}, ${input.phone}, ${resolved.method}, ${chosen?.slug ?? null}, ${chosen?.name ?? null},
      ${address}, ${input.status}, ${input.note}, ${sub}, ${ship}, ${tax}, ${total}, ${history}
    )
  `;
  await writeLines(sql, id, input.items);
  const order = await readDeskOrder(sql, ownerId, id);
  if (!order) throw new Error("The order did not save.");
  return order;
}

export async function deleteDeskOrder(sql: Sql, ownerId: string, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`delete from orders where id = ${id} and owner_user_id = ${ownerId} returning id`;
  return rows.length > 0;
}
