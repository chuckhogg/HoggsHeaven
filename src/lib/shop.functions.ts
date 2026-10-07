import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Order, OrderStatus } from "@/lib/farm-store";
import type { Product } from "@/lib/catalog";

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

async function readProducts(sql: Sql): Promise<Product[]> {
  const products = await sql<{ id: number; slug: string; name: string; kind: "eggs" | "birds"; image: string; description: string }>`
    select id, slug, name, kind, image, description from products order by id
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
  customer_name, customer_email, customer_phone, method, address, status, note,
  subtotal::float8 as subtotal, shipping::float8 as shipping, tax::float8 as tax, total::float8 as total,
  history
`;

async function seedIfEmpty(sql: Sql) {
  const count = await sql<{ n: number }>`select count(*)::int as n from products`;
  if (Number(count[0]?.n ?? 0) > 0) return;
  const { products } = await import("@/lib/catalog");
  for (const product of products) {
    const inserted = await sql<{ id: number }>`
      insert into products (slug, name, kind, image, description)
      values (${product.slug}, ${product.name}, ${product.kind}, ${product.image}, ${product.description})
      returning id
    `;
    const id = inserted[0]?.id;
    if (!id) continue;
    for (const variant of product.variants) {
      await sql`
        insert into variants (product_id, sku, label, price, compare_price, stock)
        values (${id}, ${variant.sku}, ${variant.label}, ${variant.price}, ${variant.compare}, ${variant.stock})
      `;
    }
  }
}

export const listShop = createServerFn({ method: "GET" }).handler(async () => {
  await noStore();
  const sql = await db();
  await seedIfEmpty(sql);
  return { products: await readProducts(sql), settings: await readSettings(sql) };
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
       from order_items where order_id = $1`,
      [found[0].id],
    );
    return packOrders(found, items)[0] ?? null;
  });

type CheckoutLine = { slug?: string; variantId?: number; qty?: number };

export const placeShopOrder = createServerFn({ method: "POST" })
  .validator((input: {
    customer?: { name?: string; email?: string; phone?: string };
    method?: string;
    address?: string;
    note?: string;
    items?: CheckoutLine[];
  }) => {
    const method = input?.method === "ship" ? "ship" : "pickup";
    const items = Array.isArray(input?.items) ? input.items.slice(0, 30) : [];
    return {
      name: text(input?.customer?.name, 80),
      email: text(input?.customer?.email, 120).toLowerCase(),
      phone: text(input?.customer?.phone, 30),
      method: method as "pickup" | "ship",
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
    if (data.method === "ship" && lines.some((line) => line.product.kind === "birds")) {
      throw new Error("Live birds are pickup only.");
    }
    if (data.method === "ship" && data.address.length < 5) throw new Error("Add a shipping address for hatching eggs.");
    const settings = await readSettings(sql);
    const sub = Math.round(lines.reduce((sum, line) => sum + line.variant.price * line.qty, 0) * 100) / 100;
    const ship = data.method === "ship" ? settings.shipEggs : 0;
    const tax = Math.round(sub * settings.taxRate * 100) / 100;
    const total = Math.round((sub + ship + tax) * 100) / 100;
    const id = orderId();
    const created = new Date().toISOString();
    const history = JSON.stringify([{ at: created, status: "awaiting-payment", note: "Order placed. No card number was collected." }]);
    const owner = (await ownerId(sql)) ?? "pending";
    const address = data.method === "ship" ? data.address : "Farm pickup, Shelbyville, KY 40065";
    await sql`
      insert into orders (
        id, owner_user_id, customer_name, customer_email, customer_phone, method, address, status, note,
        subtotal, shipping, tax, total, history
      ) values (
        ${id}, ${owner}, ${data.name}, ${data.email}, ${data.phone}, ${data.method}, ${address},
        ${"awaiting-payment"}, ${data.note}, ${sub}, ${ship}, ${tax}, ${total}, ${history}
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
      `select order_id, slug, variant_id, name, label, price::float8 as price, image, qty, sku, kind from order_items where order_id = $1`,
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
        customer_name, customer_email, customer_phone, method, address, status, note,
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
    image?: string;
    description?: string;
    variants?: VariantInput[];
  }) => ({
    id: input?.id ? Number(input.id) : 0,
    name: text(input?.name, 120),
    kind: input?.kind === "birds" ? "birds" as const : "eggs" as const,
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
    if (data.id) {
      const existing = await sql<{ id: number }>`select id from products where id = ${data.id}`;
      if (!existing[0]) throw new Error("That listing is gone.");
      await sql`
        update products set name = ${data.name}, kind = ${data.kind}, image = ${image}, description = ${data.description}
        where id = ${data.id}
      `;
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
      insert into products (slug, name, kind, image, description)
      values (${slug}, ${data.name}, ${data.kind}, ${image}, ${data.description})
      returning id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new Error("The listing did not save.");
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

export const saveOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    method?: string;
    address?: string;
    status?: string;
    note?: string;
    items?: AdminLine[];
  }) => {
    const status = STATUSES.includes(input?.status as OrderStatus) ? (input?.status as OrderStatus) : "awaiting-payment";
    return {
      id: text(input?.id, 40),
      name: text(input?.name, 80),
      email: text(input?.email, 120).toLowerCase(),
      phone: text(input?.phone, 30),
      method: (input?.method === "ship" ? "ship" : "pickup") as "pickup" | "ship",
      address: text(input?.address, 200),
      status,
      note: text(input?.note, 500),
      items: (Array.isArray(input?.items) ? input.items : []).slice(0, 30).map((item) => ({
        name: text(item?.name, 120),
        label: text(item?.label, 80) || "Custom",
        price: moneyNum(item?.price),
        qty: Math.min(99, Math.max(1, Math.floor(Number(item?.qty) || 1))),
        sku: text(item?.sku, 40),
        image: text(item?.image, 500),
        kind: (item?.kind === "birds" ? "birds" : "eggs") as "eggs" | "birds",
        slug: text(item?.slug, 80) || "custom",
      })),
    };
  })
  .handler(async ({ data, context }) => {
    await noStore();
    if (!data.name || !data.email.includes("@")) throw new Error("Name and email are required.");
    if (data.items.length === 0 || data.items.some((item) => !item.name)) throw new Error("Add at least one line.");
    if (data.method === "ship" && data.items.some((item) => item.kind === "birds")) {
      throw new Error("Live birds are pickup only.");
    }
    const sql = await requireOwner(context.userId);
    const settings = await readSettings(sql);
    const sub = Math.round(data.items.reduce((sum, item) => sum + item.price * item.qty, 0) * 100) / 100;
    const ship = data.method === "ship" ? settings.shipEggs : 0;
    const tax = Math.round(sub * settings.taxRate * 100) / 100;
    const total = Math.round((sub + ship + tax) * 100) / 100;
    const address = data.method === "ship" ? data.address : "Farm pickup, Shelbyville, KY 40065";
    let id = data.id;
    if (id) {
      const existing = await sql<{ status: OrderStatus; history: string }>`
        select status, history from orders where id = ${id} and owner_user_id = ${context.userId}
      `;
      if (!existing[0]) throw new Error("That order is not on this desk.");
      let history: Order["history"] = [];
      try {
        history = JSON.parse(existing[0].history) as Order["history"];
      } catch {
        history = [];
      }
      if (existing[0].status !== data.status) {
        history = [...history, { at: new Date().toISOString(), status: data.status, note: "Updated from the farm desk" }];
      }
      await sql`
        update orders set
          customer_name = ${data.name},
          customer_email = ${data.email},
          customer_phone = ${data.phone},
          method = ${data.method},
          address = ${address},
          status = ${data.status},
          note = ${data.note},
          subtotal = ${sub},
          shipping = ${ship},
          tax = ${tax},
          total = ${total},
          history = ${JSON.stringify(history)}
        where id = ${id} and owner_user_id = ${context.userId}
      `;
      await sql`delete from order_items where order_id = ${id}`;
    } else {
      id = orderId();
      const history = JSON.stringify([{ at: new Date().toISOString(), status: data.status, note: "Added from the farm desk" }]);
      await sql`
        insert into orders (
          id, owner_user_id, customer_name, customer_email, customer_phone, method, address, status, note,
          subtotal, shipping, tax, total, history
        ) values (
          ${id}, ${context.userId}, ${data.name}, ${data.email}, ${data.phone}, ${data.method}, ${address},
          ${data.status}, ${data.note}, ${sub}, ${ship}, ${tax}, ${total}, ${history}
        )
      `;
    }
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
    const shipEggs = moneyNum(input?.shipEggs ?? 0);
    const taxRate = Number(input?.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 0.25) throw new Error("Tax rate must be between 0 and 0.25.");
    return { shipEggs, taxRate: Math.round(taxRate * 10000) / 10000 };
  })
  .handler(async ({ data, context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    await sql`
      insert into shop_settings (id, ship_eggs, tax_rate) values (1, ${data.shipEggs}, ${data.taxRate})
      on conflict (id) do update set ship_eggs = ${data.shipEggs}, tax_rate = ${data.taxRate}
    `;
    return { ok: true };
  });
