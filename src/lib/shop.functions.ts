import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Product } from "@/lib/catalog";
import {
  cartShipping,
  DEFAULT_METHODS,
  guessCategory,
  kindForCategory,
  normalizeAssignedMethods,
  parseCategory,
  PICKUP_ADDRESS,
  roundMoney,
  subtotalOf,
  type ProductCategory,
  type ShippingMethod,
} from "@/lib/shipping";

/** shipEggs is the old flat egg rate, kept only for compatibility; checkout prices come from shipping methods. */
export type ShopSettings = { shipEggs: number; taxRate: number };

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;
type OrderRowShape = import("@/lib/order-desk.server").OrderRow;
type ItemRowShape = import("@/lib/order-desk.server").ItemRow;

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

async function readShippingMethods(sql: Sql, withNotes = false): Promise<ShippingMethod[]> {
  const desk = await import("@/lib/order-desk.server");
  return desk.readShippingMethods(sql, withNotes);
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
    const { ITEM_SELECT, ORDER_SELECT, packOrders } = await import("@/lib/order-desk.server");
    const found = await sql.query<OrderRowShape>(
      `select ${ORDER_SELECT} from orders where lower(id) = lower($1) and lower(customer_email) = lower($2)`,
      [data.id, data.email],
    );
    if (!found[0]) return null;
    const items = await sql.query<ItemRowShape>(`select ${ITEM_SELECT} from order_items where order_id = $1 order by id`, [found[0].id]);
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
    const desk = await import("@/lib/order-desk.server");
    const id = desk.newOrderId();
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
    const found = await sql.query<OrderRowShape>(`select ${desk.ORDER_SELECT} from orders where id = $1`, [id]);
    const stored = await sql.query<ItemRowShape>(`select ${desk.ITEM_SELECT} from order_items where order_id = $1 order by id`, [id]);
    const order = desk.packOrders(found, stored)[0];
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
    const { listDeskOrders } = await import("@/lib/order-desk.server");
    return listDeskOrders(sql, context.userId);
  });

/** One order for the desk's order view, or null when it isn't on this desk. */
export const getAdminOrder = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: text(input?.id, 60) }))
  .handler(async ({ data, context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    const { readDeskOrder } = await import("@/lib/order-desk.server");
    return data.id ? readDeskOrder(sql, context.userId, data.id) : null;
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

/**
 * Partial edit of an existing order from the order view. Only the fields sent
 * are validated and written; stored totals stay unless lines or the method
 * change; a status change appends to the order's history.
 */
export const updateOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; patch?: Record<string, unknown> }) => ({
    id: text(input?.id, 60),
    patch: (input?.patch && typeof input.patch === "object" ? input.patch : {}) as Record<string, unknown>,
  }))
  .handler(async ({ data, context }) => {
    await noStore();
    if (!data.id) throw new Error("Which order?");
    const sql = await requireOwner(context.userId);
    const desk = await import("@/lib/order-desk.server");
    return desk.updateDeskOrder(sql, context.userId, data.id, desk.parseOrderPatch(data.patch));
  });

/** Add an order from the desk (the order view in "new" mode). */
export const createOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: Record<string, unknown>) => (input && typeof input === "object" ? input : {}))
  .handler(async ({ data, context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    const desk = await import("@/lib/order-desk.server");
    return desk.createDeskOrder(sql, context.userId, desk.parseNewOrder(data));
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: text(input?.id, 60) }))
  .handler(async ({ data, context }) => {
    await noStore();
    const sql = await requireOwner(context.userId);
    const { deleteDeskOrder } = await import("@/lib/order-desk.server");
    if (!(await deleteDeskOrder(sql, context.userId, data.id))) throw new Error("That order is not on this desk.");
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
