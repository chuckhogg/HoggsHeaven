import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Order, OrderStatus } from "@/lib/farm-store";
import type { Product } from "@/lib/catalog";
import {
  cartShipping,
  DEFAULT_METHODS,
  guessCategory,
  kindForCategory,
  normalizeAssignedMethods,
  parseCategory,
  PICKUP_ADDRESS,
  planOrderEdit,
  roundMoney,
  sortMethods,
  subtotalOf,
  type ProductCategory,
  type ShippingMethod,
} from "@/lib/shipping";

/** shipEggs is the old flat egg rate, kept only for compatibility; checkout prices come from shipping methods. */
export type ShopSettings = { shipEggs: number; taxRate: number };

const STATUSES: OrderStatus[] = [
  "awaiting-payment",
  "paid",
  "packing",
  "shipped",
  "ready-for-pickup",
  "completed",
  "cancelled",
];

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

async function db() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

async function noStore() {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("cache-control", "no-store");
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function moneyNum(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error("Enter a valid price.");
  return Math.round(n * 100) / 100;
}

function imageUrl(value: unknown) {
  const url = text(value, 500);
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Use an https image address.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Use an https image address.");
  return url;
}

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return base || "listing";
}

function orderId() {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let tail = "";
  for (const byte of bytes) tail += alphabet[byte % alphabet.length];
  return `HH-${stamp}-${tail}`;
}

async function ownerId(sql: Sql) {
  const rows = await sql<{ user_id: string }>`select user_id from shop_owner where id = 1`;
  return rows[0]?.user_id ?? null;
}

async function requireOwner(userId: string) {
  const sql = await db();
  const current = await ownerId(sql);
  if (!current || current !== userId) throw new Error("This farm desk belongs to another account.");
  return sql;
}

async function readSettings(sql: Sql): Promise<ShopSettings> {
  const rows = await sql<{ ship_eggs: number; tax_rate: number }>`
    select ship_eggs::float8 as ship_eggs, tax_rate::float8 as tax_rate from shop_settings where id = 1
  `;
  return { shipEggs: Number(rows[0]?.ship_eggs ?? 18), taxRate: Number(rows[0]?.tax_rate ?? 0) };
}

type MethodRow = {
  slug: string;
  carrier: string;
  name: string;
  price: number | null;
  active: boolean;
  sort_order: number;
  notes: string;
};

async function readShippingMethods(sql: Sql, withNotes = false): Promise<ShippingMethod[]> {
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

async function readProducts(sql: Sql): Promise<Product[]> {
  const products = await sql<{
    id: number;
    slug: string;
    name: string;
    kind: "eggs" | "birds";
    category: ProductCategory;
    image: string;
    description: string;
  }>`
    select id, slug, name, kind, category, image, description from products order by id
  `;
  const assigned = await sql<{ product_id: number; method_slug: string }>`
    select product_id, method_slug from product_shipping_methods
  `;
  const variants = await sql<{
    id: number;
    product_id: number;
    sku: string;
    label: string;
    price: number;
    compare_price: number | null;
    stock: number | null;
  }>`
    select id, product_id, sku, label, price::float8 as price, compare_price::float8 as compare_price, stock
    from variants order by id
  `;
  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    kind: product.kind,
    category: parseCategory(product.category, product.kind),
    shipping: assigned.filter((row) => row.product_id === product.id).map((row) => row.method_slug),
    image: product.image,
    description: product.description,
    variants: variants
      .filter((variant) => variant.product_id === product.id)
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        label: variant.label,
        price: Number(variant.price),
        compare: variant.compare_price == null ? null : Number(variant.compare_price),
        stock: variant.stock == null ? null : Number(variant.stock),
      })),
  }));
}

type OrderRow = {
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

type ItemRow = {
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

function packOrders(rows: OrderRow[], items: ItemRow[]): Order[] {
  return rows.map((row) => {
    let history: Order["history"] = [];
    try {
      const parsed = JSON.parse(row.history) as Order["history"];
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      history = [];
    }
    return {
      id: row.id,
      created: row.created_at,
      customer: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
      method: row.method,
      shippingMethod: row.shipping_method ? { slug: row.shipping_method, name: row.shipping_method_name ?? row.shipping_method } : null,
      address: row.address,
      payment: { type: "pay-at-pickup" },
      status: row.status,
      history,
      note: row.note,
      totals: {
        sub: Number(row.subtotal),
        ship: Number(row.shipping),
        tax: Number(row.tax),
        total: Number(row.total),
      },
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
    };
  });
}

const ORDER_SELECT = `
  id,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
  customer_name, customer_email, customer_phone, method, shipping_method, shipping_method_name, address, status, note,
  subtotal::float8 as subtotal, shipping::float8 as shipping, tax::float8 as tax, total::float8 as total,
  history
`;

async function seedIfEmpty(sql: Sql) {
  const count = await sql<{ n: number }>`select count(*)::int as n from products`;
  if (Number(count[0]?.n ?? 0) > 0) return;
  const { products } = await import("@/lib/catalog");
  const known = await readShippingMethods(sql);
  for (const product of products) {
    const category = guessCategory(product.kind, product.variants.map((variant) => variant.label));
    const inserted = await sql<{ id: number }>`
      insert into products (slug, name, kind, category, image, description)
      values (${product.slug}, ${product.name}, ${product.kind}, ${category}, ${product.image}, ${product.description})
      returning id
    `;
    const id = inserted[0]?.id;
    if (!id) continue;
    await assignMethods(sql, id, normalizeAssignedMethods(DEFAULT_METHODS[category], known));
    for (const variant of product.variants) {
      await sql`
        insert into variants (product_id, sku, label, price, compare_price, stock)
        values (${id}, ${variant.sku}, ${variant.label}, ${variant.price}, ${variant.compare}, ${variant.stock})
      `;
    }
  }
}

async function assignMethods(sql: Sql, productId: number, slugs: string[]) {
  await sql`delete from product_shipping_methods where product_id = ${productId}`;
  for (const slug of slugs) {
    await sql`
      insert into product_shipping_methods (product_id, method_slug) values (${productId}, ${slug})
      on conflict do nothing
    `;
  }
}

export const listShop = createServerFn({ method: "GET" }).handler(async () => {
  await noStore();
  const sql = await db();
  await seedIfEmpty(sql);
  // Shoppers only need active methods; unpriced ones stay so the shop can say
  // "not priced yet", but admin notes are left out.
  const shipping = (await readShippingMethods(sql)).filter((method) => method.active);
  return { products: await readProducts(sql), settings: await readSettings(sql), shipping };
});

export const trackOrder = createServerFn({ method: "POST" })
  .validator((input: { id?: string; email?: string }) => ({
    id: text(input?.id, 40),
    email: text(input?.email, 120).toLowerCase(),
  }))
  .handler(async ({ data }) => {
    await noStore();
    if (!data.id || !data.email.includes("@")) return null;
    const sql = await db();
    const found = await sql.query<OrderRow>(
      `select ${ORDER_SELECT} from orders where lower(id) = lower($1) and lower(customer_email) = lower($2)`,
      [data.id, data.email],
    );
    if (!found[0]) return null;
    const items = await sql.query<ItemRow>(
      `select order_id, slug, variant_id, name, label, price::float8 as price, image, qty, sku, kind
       from order_items where order_id = $1 order by id`,
      [found[0].id],
    );
    return packOrders(found, items)[0] ?? null;
  });

type CheckoutLine = { slug?: string; variantId?: number; qty?: number };

export const placeShopOrder = createServerFn({ method: "POST" })
  .validator((input: {
    customer?: { name?: string; email?: string; phone?: string };
    method?: string;
    /** "pickup" or a shipping method slug. */
    shipping?: string;
    address?: string;
    note?: string;
    items?: CheckoutLine[];
  }) => {
    const choice = text(input?.shipping, 60);
    const method = (choice && choice !== "pickup") || input?.method === "ship" ? "ship" : "pickup";
    const items = Array.isArray(input?.items) ? input.items.slice(0, 30) : [];
    return {
      name: text(input?.customer?.name, 80),
      email: text(input?.customer?.email, 120).toLowerCase(),
      phone: text(input?.customer?.phone, 30),
      method: method as "pickup" | "ship",
      shipping: method === "ship" && choice !== "pickup" ? choice : "",
      address: text(input?.address, 200),
      note: text(input?.note, 500),
      items: items.map((item) => ({
        slug: text(item?.slug, 80),
        variantId: Number(item?.variantId),
        qty: Math.min(99, Math.max(1, Math.floor(Number(item?.qty) || 1))),
      })),
    };
  })
  .handler(async ({ data }) => {
    await noStore();
    if (!data.name || !data.email.includes("@") || !data.phone) throw new Error("Name, email, and phone are required.");
    if (data.items.length === 0) throw new Error("The cart is empty.");
    const sql = await db();
    await seedIfEmpty(sql);
    const products = await readProducts(sql);
    const lines = data.items.map((item) => {
      const product = products.find((entry) => entry.slug === item.slug);
      const variant = product?.variants.find((entry) => entry.id === item.variantId);
      if (!product || !variant) throw new Error("A listing in the cart is no longer available.");
      if (variant.stock === 0) throw new Error(`${product.name} is sold out.`);
      return { product, variant, qty: item.qty };
    });
    // Shipping: only a method every item allows, that is active and priced.
    // Live birds ship whenever their listing allows the chosen method.
    let chosen: (ShippingMethod & { price: number }) | null = null;
    if (data.method === "ship") {
      const offer = cartShipping(
        lines.map((line) => ({ name: line.product.name, category: line.product.category, shipping: line.product.shipping })),
        await readShippingMethods(sql),
      );
      if (!data.shipping) throw new Error(offer.reason || "Choose a shipping method.");
      chosen = offer.options.find((option) => option.slug === data.shipping) ?? null;
      if (!chosen) throw new Error(offer.reason || "That shipping method isn't available for everything in this cart.");
      if (data.address.length < 5) throw new Error("Add a shipping address.");
    }
    const settings = await readSettings(sql);
    const sub = subtotalOf(lines.map((line) => ({ price: line.variant.price, qty: line.qty })));
    const ship = chosen ? chosen.price : 0;
    const tax = roundMoney(sub * settings.taxRate);
    const total = roundMoney(sub + ship + tax);
    const id = orderId();
    const created = new Date().toISOString();
    const history = JSON.stringify([{ at: created, status: "awaiting-payment", note: "Order placed. No card number was collected." }]);
    const owner = (await ownerId(sql)) ?? "pending";
    const address = data.method === "ship" ? data.address : PICKUP_ADDRESS;
    await sql`
      insert into orders (
        id, owner_user_id, customer_name, customer_email, customer_phone, method, shipping_method, shipping_method_name,
        address, status, note, subtotal, shipping, tax, total, history
      ) values (
        ${id}, ${owner}, ${data.name}, ${data.email}, ${data.phone}, ${data.method}, ${chosen?.slug ?? null}, ${chosen?.name ?? null},
        ${address}, ${"awaiting-payment"}, ${data.note}, ${sub}, ${ship}, ${tax}, ${total}, ${history}
      )
    `;
    for (const line of lines) {
      await sql`
        insert into order_items (order_id, slug, variant_id, name, label, price, image, qty, sku, kind)
        values (
          ${id}, ${line.product.slug}, ${line.variant.id}, ${line.product.name}, ${line.variant.label},
          ${line.variant.price}, ${line.product.image}, ${line.qty}, ${line.variant.sku}, ${line.product.kind}
        )
      `;
    }
    const found = await sql.query<OrderRow>(`select ${ORDER_SELECT} from orders where id = $1`, [id]);
    const stored = await sql.query<ItemRow>(
      `select order_id, slug, variant_id, name, label, price::float8 as price, image, qty, sku, kind from order_items where order_id = $1 order by id`,
      [id],
    );
    const order = packOrders(found, stored)[0];
    if (!order) throw new Error("The order did not save.");
    return order;
  });

export const adminState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await noStore();
    const { deskStateFor } = await import("@/lib/desk-access.server");
    return deskStateFor(await db(), context.userId, process.env);
  });

export const claimDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await noStore();
    const { claimDeskFor } = await import("@/lib/desk-access.server");
    return claimDeskFor(await db(), context.userId, process.env);
  });

export const listAdminOrders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    const rows = await sql<OrderRow>`
      select id,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
        customer_name, customer_email, customer_phone, method, shipping_method, shipping_method_name, address, status, note,
        subtotal::float8 as subtotal, shipping::float8 as shipping, tax::float8 as tax, total::float8 as total,
        history
      from orders where owner_user_id = ${context.userId}
      order by created_at desc
    `;
    const items = await sql<ItemRow>`
      select oi.order_id, oi.slug, oi.variant_id, oi.name, oi.label, oi.price::float8 as price, oi.image, oi.qty, oi.sku, oi.kind
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.owner_user_id = ${context.userId}
      order by oi.id
    `;
    return packOrders(rows, items);
  });

type VariantInput = { sku?: string; label?: string; price?: number; compare?: number | null; stock?: number | null };

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    id?: number;
    name?: string;
    kind?: string;
    category?: string;
    /** Shipping method slugs. Omit to keep the listing's current methods (or the category defaults for a new one). */
    shipping?: string[];
    image?: string;
    description?: string;
    variants?: VariantInput[];
  }) => ({
    id: input?.id ? Number(input.id) : 0,
    name: text(input?.name, 120),
    category: parseCategory(input?.category, input?.kind),
    shipping: Array.isArray(input?.shipping) ? input.shipping.slice(0, 30).map((slug) => text(slug, 60)) : null,
    image: text(input?.image, 500),
    description: text(input?.description, 8000),
    variants: (Array.isArray(input?.variants) ? input.variants : []).slice(0, 12).map((variant) => ({
      sku: text(variant?.sku, 40) || "SKU",
      label: text(variant?.label, 80),
      price: moneyNum(variant?.price),
      compare: variant?.compare == null || variant.compare === ("" as unknown) ? null : moneyNum(variant.compare),
      stock: variant?.stock == null || String(variant.stock) === "" ? null : Math.max(0, Math.floor(Number(variant.stock))),
    })),
  }))
  .handler(async ({ data, context }) => {
    await noStore();
    if (!data.name) throw new Error("Name the listing.");
    if (data.variants.length === 0 || data.variants.some((variant) => !variant.label)) {
      throw new Error("Each listing needs at least one option with a label.");
    }
    const image = imageUrl(data.image);
    const sql = await requireOwner(context.userId);
    const kind = kindForCategory(data.category);
    const known = await readShippingMethods(sql);
    if (data.id) {
      const existing = await sql<{ id: number }>`select id from products where id = ${data.id}`;
      if (!existing[0]) throw new Error("That listing is gone.");
      await sql`
        update products set name = ${data.name}, kind = ${kind}, category = ${data.category}, image = ${image},
          description = ${data.description}
        where id = ${data.id}
      `;
      if (data.shipping) await assignMethods(sql, data.id, normalizeAssignedMethods(data.shipping, known));
      await sql`delete from variants where product_id = ${data.id}`;
      for (const variant of data.variants) {
        await sql`
          insert into variants (product_id, sku, label, price, compare_price, stock)
          values (${data.id}, ${variant.sku}, ${variant.label}, ${variant.price}, ${variant.compare}, ${variant.stock})
        `;
      }
      return { id: data.id };
    }
    let slug = slugify(data.name);
    const taken = await sql<{ slug: string }>`select slug from products where slug = ${slug} or slug like ${`${slug}-%`}`;
    if (taken.some((row) => row.slug === slug)) slug = `${slug}-${taken.length + 1}`;
    const inserted = await sql<{ id: number }>`
      insert into products (slug, name, kind, category, image, description)
      values (${slug}, ${data.name}, ${kind}, ${data.category}, ${image}, ${data.description})
      returning id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new Error("The listing did not save.");
    await assignMethods(sql, id, normalizeAssignedMethods(data.shipping ?? DEFAULT_METHODS[data.category], known));
    for (const variant of data.variants) {
      await sql`
        insert into variants (product_id, sku, label, price, compare_price, stock)
        values (${id}, ${variant.sku}, ${variant.label}, ${variant.price}, ${variant.compare}, ${variant.stock})
      `;
    }
    return { id };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: number }) => ({ id: Number(input?.id) }))
  .handler(async ({ data, context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    await sql`delete from products where id = ${data.id}`;
    return { ok: true };
  });

type AdminLine = {
  name?: string;
  label?: string;
  price?: number;
  qty?: number;
  sku?: string;
  image?: string;
  kind?: string;
  slug?: string;
};

type DeskOrderRow = {
  method: "pickup" | "ship";
  shipping_method: string | null;
  shipping_method_name: string | null;
  address: string;
  status: OrderStatus;
  history: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
};

/** Normalize an order line the way the saveOrder validator does, so stored and edited lines compare fairly. */
function deskLine(item: AdminLine) {
  return {
    name: text(item?.name, 120),
    label: text(item?.label, 80) || text(item?.name, 80) || "Custom",
    price: moneyNum(item?.price),
    qty: Math.min(99, Math.max(1, Math.floor(Number(item?.qty) || 1))),
    sku: text(item?.sku, 40),
    image: text(item?.image, 500),
    kind: (item?.kind === "birds" ? "birds" : "eggs") as "eggs" | "birds",
    slug: text(item?.slug, 80) || "custom",
  };
}

export const saveOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    /** Legacy: "pickup" | "ship". Prefer `shipping`. */
    method?: string;
    /** "pickup", a shipping method slug, or "legacy-ship" (keep an old order's unrecorded shipping method). */
    shipping?: string;
    address?: string;
    status?: string;
    note?: string;
    items?: AdminLine[];
  }) => {
    const status = STATUSES.includes(input?.status as OrderStatus) ? (input?.status as OrderStatus) : "awaiting-payment";
    const choice = text(input?.shipping, 60) || (input?.method === "ship" ? "legacy-ship" : "pickup");
    return {
      id: text(input?.id, 40),
      name: text(input?.name, 80),
      email: text(input?.email, 120).toLowerCase(),
      phone: text(input?.phone, 30),
      method: (choice === "pickup" ? "pickup" : "ship") as "pickup" | "ship",
      shippingMethod: choice === "pickup" || choice === "legacy-ship" ? null : choice,
      address: text(input?.address, 200),
      status,
      note: text(input?.note, 4000),
      items: (Array.isArray(input?.items) ? input.items : []).slice(0, 30).map(deskLine),
    };
  })
  .handler(async ({ data, context }) => {
    await noStore();
    if (!data.name || !data.email.includes("@")) throw new Error("Name and email are required.");
    if (data.items.length === 0 || data.items.some((item) => !item.name)) throw new Error("Add at least one line.");
    const sql = await requireOwner(context.userId);
    const settings = await readSettings(sql);
    const methods = await readShippingMethods(sql);
    const chosen = data.shippingMethod ? methods.find((method) => method.slug === data.shippingMethod) ?? null : null;
    if (data.shippingMethod && !chosen) throw new Error("That shipping method no longer exists.");

    // A newly chosen method must be allowed by every listing on the order
    // (custom lines that aren't listings are up to the farm).
    async function checkMethodFitsLines() {
      if (!chosen) return;
      const products = await readProducts(sql);
      for (const item of data.items) {
        const product = products.find((entry) => entry.slug === item.slug);
        if (product && !product.shipping.includes(chosen.slug)) {
          throw new Error(`${product.name} doesn't ship by ${chosen.name}. Allow it on the listing or pick another method.`);
        }
      }
    }

    let id = data.id;
    if (id) {
      const existing = await sql<DeskOrderRow>`
        select method, shipping_method, shipping_method_name, address, status, history,
          subtotal::float8 as subtotal, shipping::float8 as shipping, tax::float8 as tax, total::float8 as total
        from orders where id = ${id} and owner_user_id = ${context.userId}
      `;
      const row = existing[0];
      if (!row) throw new Error("That order is not on this desk.");
      const storedItems = await sql<ItemRow>`
        select order_id, slug, variant_id, name, label, price::float8 as price, image, qty, sku, kind
        from order_items where order_id = ${id} order by id
      `;
      // An unrecorded (legacy) ship order stays "legacy" unless the farm picks a real method.
      const plan = planOrderEdit(
        {
          method: row.method,
          shippingMethod: row.shipping_method,
          address: row.address,
          subtotal: Number(row.subtotal),
          shipping: Number(row.shipping),
          tax: Number(row.tax),
          total: Number(row.total),
          items: storedItems.map((item) => deskLine({ ...item, price: Number(item.price) })),
        },
        { method: data.method, shippingMethod: data.shippingMethod, address: data.address, items: data.items },
        { taxRate: settings.taxRate, newShipping: chosen ? chosen.price : data.method === "pickup" ? 0 : null },
      );
      if (plan.methodChanged) await checkMethodFitsLines();
      let history: Order["history"] = [];
      try {
        history = JSON.parse(row.history) as Order["history"];
      } catch {
        history = [];
      }
      if (row.status !== data.status) {
        history = [...history, { at: new Date().toISOString(), status: data.status, note: "Updated from the farm desk" }];
      }
      const methodSlug = plan.methodChanged ? chosen?.slug ?? null : row.shipping_method;
      const methodName = plan.methodChanged ? chosen?.name ?? null : row.shipping_method_name;
      await sql`
        update orders set
          customer_name = ${data.name},
          customer_email = ${data.email},
          customer_phone = ${data.phone},
          method = ${data.method},
          shipping_method = ${methodSlug},
          shipping_method_name = ${methodName},
          address = ${plan.address},
          status = ${data.status},
          note = ${data.note},
          subtotal = ${plan.subtotal},
          shipping = ${plan.shipping},
          tax = ${plan.tax},
          total = ${plan.total},
          history = ${JSON.stringify(history)}
        where id = ${id} and owner_user_id = ${context.userId}
      `;
      // Unchanged lines are left alone so imported rows keep their original data.
      if (plan.itemsChanged) {
        await sql`delete from order_items where order_id = ${id}`;
        for (const item of data.items) {
          await sql`
            insert into order_items (order_id, slug, variant_id, name, label, price, image, qty, sku, kind)
            values (${id}, ${item.slug}, ${null}, ${item.name}, ${item.label}, ${item.price}, ${item.image}, ${item.qty}, ${item.sku}, ${item.kind})
          `;
        }
      }
      return { id };
    }

    if (data.method === "ship" && !chosen) throw new Error("Pick a shipping method for a shipped order.");
    if (chosen && chosen.price == null) throw new Error(`Set a price for ${chosen.name} under Shipping first.`);
    await checkMethodFitsLines();
    const sub = subtotalOf(data.items);
    const ship = chosen?.price ?? 0;
    const tax = roundMoney(sub * settings.taxRate);
    const total = roundMoney(sub + ship + tax);
    const address = data.address || (data.method === "pickup" ? PICKUP_ADDRESS : "");
    if (data.method === "ship" && address.length < 5) throw new Error("Add a shipping address.");
    id = orderId();
    const history = JSON.stringify([{ at: new Date().toISOString(), status: data.status, note: "Added from the farm desk" }]);
    await sql`
      insert into orders (
        id, owner_user_id, customer_name, customer_email, customer_phone, method, shipping_method, shipping_method_name,
        address, status, note, subtotal, shipping, tax, total, history
      ) values (
        ${id}, ${context.userId}, ${data.name}, ${data.email}, ${data.phone}, ${data.method}, ${chosen?.slug ?? null}, ${chosen?.name ?? null},
        ${address}, ${data.status}, ${data.note}, ${sub}, ${ship}, ${tax}, ${total}, ${history}
      )
    `;
    for (const item of data.items) {
      await sql`
        insert into order_items (order_id, slug, variant_id, name, label, price, image, qty, sku, kind)
        values (${id}, ${item.slug}, ${null}, ${item.name}, ${item.label}, ${item.price}, ${item.image}, ${item.qty}, ${item.sku}, ${item.kind})
      `;
    }
    return { id };
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: text(input?.id, 40) }))
  .handler(async ({ data, context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    await sql`delete from orders where id = ${data.id} and owner_user_id = ${context.userId}`;
    return { ok: true };
  });

export const saveShopSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { shipEggs?: number; taxRate?: number }) => {
    // shipEggs is legacy (the old flat egg rate). Shipping prices now live on
    // shipping methods; omit it to leave the stored value alone.
    const shipEggs = input?.shipEggs == null ? null : moneyNum(input.shipEggs);
    const taxRate = Number(input?.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 0.25) throw new Error("Tax rate must be between 0 and 0.25.");
    return { shipEggs, taxRate: Math.round(taxRate * 10000) / 10000 };
  })
  .handler(async ({ data, context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    await sql`
      insert into shop_settings (id, ship_eggs, tax_rate) values (1, ${data.shipEggs ?? 18}, ${data.taxRate})
      on conflict (id) do update set
        ship_eggs = coalesce(${data.shipEggs}::numeric, shop_settings.ship_eggs),
        tax_rate = ${data.taxRate}
    `;
    return { ok: true };
  });

export const listShippingMethods = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    const methods = await readShippingMethods(sql, true);
    const counts = await sql<{ method_slug: string; n: number }>`
      select method_slug, count(*)::int as n from product_shipping_methods group by method_slug
    `;
    return methods.map((method) => ({
      ...method,
      listings: Number(counts.find((row) => row.method_slug === method.slug)?.n ?? 0),
    }));
  });

export const saveShippingMethod = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    slug?: string;
    carrier?: string;
    name?: string;
    price?: number | string | null;
    active?: boolean;
    sortOrder?: number;
    notes?: string;
  }) => {
    const rawPrice = input?.price;
    const price = rawPrice == null || String(rawPrice).trim() === "" ? null : moneyNum(rawPrice);
    return {
      slug: text(input?.slug, 60),
      carrier: text(input?.carrier, 20) || "USPS",
      name: text(input?.name, 80),
      price,
      active: input?.active !== false,
      sortOrder: Math.max(0, Math.min(10000, Math.floor(Number(input?.sortOrder) || 0))),
      notes: text(input?.notes, 500),
    };
  })
  .handler(async ({ data, context }) => {
    await noStore();
    if (!data.name) throw new Error("Name the shipping method.");
    const sql = await requireOwner(context.userId);
    if (data.slug) {
      const updated = await sql<{ slug: string }>`
        update shipping_methods set carrier = ${data.carrier}, name = ${data.name}, price = ${data.price},
          active = ${data.active}, sort_order = ${data.sortOrder}, notes = ${data.notes}
        where slug = ${data.slug}
        returning slug
      `;
      if (!updated[0]) throw new Error("That shipping method is gone.");
      return { slug: data.slug };
    }
    const bare = data.name.toLowerCase().startsWith(`${data.carrier.toLowerCase()} `) ? data.name.slice(data.carrier.length + 1) : data.name;
    let slug = slugify(`${data.carrier} ${bare}`);
    const taken = await sql<{ slug: string }>`select slug from shipping_methods where slug = ${slug} or slug like ${`${slug}-%`}`;
    if (taken.some((row) => row.slug === slug)) slug = `${slug}-${taken.length + 1}`;
    await sql`
      insert into shipping_methods (slug, carrier, name, price, active, sort_order, notes)
      values (${slug}, ${data.carrier}, ${data.name}, ${data.price}, ${data.active}, ${data.sortOrder}, ${data.notes})
    `;
    return { slug };
  });
