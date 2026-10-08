/**
 * Shipping types (pure, shared by the browser and the server).
 *
 * Every listing has a category (hatching eggs, chicks, adult birds) and a set
 * of shipping methods it can go out by. Farm pickup is always offered and free.
 * A cart can ship by a method only when EVERY item in it allows that method,
 * the method is active, and it has a price. A method with no price is never
 * offered to shoppers; the farm desk shows it as "Needs price".
 *
 * No path aliases here: node's --experimental-strip-types test runner imports
 * this file directly.
 */

export type ProductCategory = "eggs" | "chicks" | "adult";

export const PRODUCT_CATEGORIES: ProductCategory[] = ["eggs", "chicks", "adult"];

export type ShippingMethod = {
  slug: string;
  carrier: string;
  name: string;
  /** Dollars. null = the farm has not set a price, so shoppers never see it. */
  price: number | null;
  active: boolean;
  sortOrder: number;
  notes?: string;
};

/** Default methods a listing gets, by category (matches migrations/0003). */
export const DEFAULT_METHODS: Record<ProductCategory, string[]> = {
  adult: ["usps-priority-express"],
  chicks: ["usps-priority", "usps-priority-express"],
  eggs: ["usps-priority", "ups-ground", "ups-3-day", "ups-2-day", "ups-next-day"],
};

export const PICKUP_ADDRESS = "Farm pickup, Shelbyville, KY 40065";

export function categoryLabel(category: ProductCategory, plural = true) {
  if (category === "eggs") return "Hatching eggs";
  if (category === "chicks") return plural ? "Chicks" : "Chick";
  return plural ? "Adult birds" : "Adult bird";
}

/** Order-item / legacy kind for a category. Chicks and adults are both "birds". */
export function kindForCategory(category: ProductCategory): "eggs" | "birds" {
  return category === "eggs" ? "eggs" : "birds";
}

export function parseCategory(value: unknown, fallbackKind?: unknown): ProductCategory {
  if (value === "eggs" || value === "chicks" || value === "adult") return value;
  if (fallbackKind === "eggs") return "eggs";
  if (fallbackKind === "birds") return "adult";
  return "eggs";
}

/**
 * Best guess for a listing that predates categories (same rule as the 0003
 * migration): eggs stay eggs; birds whose every option mentions "chick" are
 * chicks; anything else (adults, "Standard", or a mix) is adult.
 */
export function guessCategory(kind: "eggs" | "birds", optionLabels: string[]): ProductCategory {
  if (kind === "eggs") return "eggs";
  if (optionLabels.length > 0 && optionLabels.every((label) => /chick/i.test(label))) return "chicks";
  return "adult";
}

/** Keep only known method slugs, in table order, without duplicates. */
export function normalizeAssignedMethods(input: unknown, known: ShippingMethod[]): string[] {
  const wanted = new Set(Array.isArray(input) ? input.map((slug) => String(slug)) : []);
  return sortMethods(known)
    .filter((method) => wanted.has(method.slug))
    .map((method) => method.slug);
}

export function sortMethods<T extends ShippingMethod>(methods: T[]): T[] {
  return [...methods].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function isOffered(method: ShippingMethod) {
  return method.active && method.price != null && Number.isFinite(method.price);
}

export type CartShippingLine = { name: string; category: ProductCategory; shipping: string[] };

export type CartShipping = {
  /** Methods the shopper can pick (besides farm pickup), cheapest first by sort order. */
  options: (ShippingMethod & { price: number })[];
  /** Methods every item allows that are waiting on a price or are switched off. */
  waiting: ShippingMethod[];
  /** Short reason shown when options is empty. "" when shipping is available. */
  reason: string;
};

function listNames(names: string[]) {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/**
 * Shipping choices for a cart: the methods every line allows (intersection),
 * minus anything inactive or unpriced. Farm pickup is always available on top.
 */
export function cartShipping(lines: CartShippingLine[], methods: ShippingMethod[]): CartShipping {
  if (lines.length === 0) return { options: [], waiting: [], reason: "" };
  const sorted = sortMethods(methods);
  const common = sorted.filter((method) => lines.every((line) => line.shipping.includes(method.slug)));
  const options = common.filter(isOffered) as (ShippingMethod & { price: number })[];
  const waiting = common.filter((method) => !isOffered(method));
  if (options.length > 0) return { options, waiting, reason: "" };

  const noShipping = lines.filter((line) => line.shipping.length === 0);
  if (noShipping.length > 0) {
    return {
      options,
      waiting,
      reason: `${listNames(noShipping.map((line) => line.name))} ${noShipping.length > 1 ? "are" : "is"} farm pickup only.`,
    };
  }
  if (common.length === 0) {
    const named = listNames(lines.map((line) => categoryLabel(line.category).toLowerCase()));
    const groups = named.charAt(0).toUpperCase() + named.slice(1);
    const sameCategory = new Set(lines.map((line) => line.category)).size === 1;
    return {
      options,
      waiting,
      reason: sameCategory
        ? "These listings don't share a shipping method — place separate orders to ship them."
        : `${groups} ship differently — place separate orders to ship both.`,
    };
  }
  const groups = listNames(lines.map((line) => categoryLabel(line.category).toLowerCase()));
  return {
    options,
    waiting,
    reason: `Shipping rates for ${groups} aren't set yet, so this order is farm pickup only for now. Email farm@hoggs.org to arrange shipping.`,
  };
}

export function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export type OrderLineForTotals = {
  name: string;
  label: string;
  price: number;
  qty: number;
  sku: string;
  kind: string;
  slug: string;
};

export function subtotalOf(lines: { price: number; qty: number }[]) {
  return roundMoney(lines.reduce((sum, line) => sum + line.price * line.qty, 0));
}

function lineKey(line: OrderLineForTotals) {
  return JSON.stringify([line.slug, line.name, line.label, roundMoney(Number(line.price)), Number(line.qty), line.sku, line.kind]);
}

export function sameLines(a: OrderLineForTotals[], b: OrderLineForTotals[]) {
  if (a.length !== b.length) return false;
  const left = a.map(lineKey).sort();
  const right = b.map(lineKey).sort();
  return left.every((key, index) => key === right[index]);
}

export type StoredOrder = {
  method: "pickup" | "ship";
  shippingMethod: string | null;
  address: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  items: OrderLineForTotals[];
};

export type OrderEdit = {
  method: "pickup" | "ship";
  /** Method slug for ship; null for pickup or a legacy order whose method was never recorded. */
  shippingMethod: string | null;
  address: string;
  items: OrderLineForTotals[];
};

export type OrderEditPlan = {
  itemsChanged: boolean;
  methodChanged: boolean;
  address: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
};

/**
 * Totals and address for an edit made on the farm desk. Stored amounts are
 * history (imported orders carry their original shipping and tax), so they
 * only move when the lines or the shipping method actually change:
 * - lines changed  -> new subtotal and tax at today's tax rate
 * - method changed -> shipping from the newly chosen method (`newShipping`)
 * - neither        -> subtotal, shipping, tax and total stay exactly as stored
 * The stored address is never replaced by a generated one; a blank address on
 * the form keeps the stored one.
 */
export function planOrderEdit(
  stored: StoredOrder,
  edit: OrderEdit,
  rates: { taxRate: number; newShipping: number | null },
): OrderEditPlan {
  const itemsChanged = !sameLines(stored.items, edit.items);
  const methodChanged =
    stored.method !== edit.method || (stored.shippingMethod ?? null) !== (edit.shippingMethod ?? null);
  const subtotal = itemsChanged ? subtotalOf(edit.items) : Number(stored.subtotal);
  let shipping = Number(stored.shipping);
  if (methodChanged) {
    if (edit.method === "pickup") shipping = 0;
    else if (rates.newShipping == null) throw new Error("Set a price for that shipping method first.");
    else shipping = rates.newShipping;
  }
  const tax = itemsChanged ? roundMoney(subtotal * rates.taxRate) : Number(stored.tax);
  const total = itemsChanged || methodChanged ? roundMoney(subtotal + shipping + tax) : Number(stored.total);
  const typed = edit.address.trim();
  return { itemsChanged, methodChanged, address: typed ? typed : stored.address, subtotal, shipping, tax, total };
}
