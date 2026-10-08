import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cartShipping,
  DEFAULT_METHODS,
  guessCategory,
  kindForCategory,
  normalizeAssignedMethods,
  parseCategory,
  planOrderEdit,
  type ShippingMethod,
  type StoredOrder,
} from "./shipping.ts";

const methods = (prices: Partial<Record<string, number | null>> = {}): ShippingMethod[] => [
  { slug: "usps-priority", carrier: "USPS", name: "USPS Priority Mail", price: 18, active: true, sortOrder: 10 },
  { slug: "usps-priority-express", carrier: "USPS", name: "USPS Priority Mail Express", price: null, active: true, sortOrder: 20 },
  { slug: "ups-ground", carrier: "UPS", name: "UPS Ground", price: null, active: true, sortOrder: 30 },
  { slug: "ups-3-day", carrier: "UPS", name: "UPS 3 Day Select", price: null, active: true, sortOrder: 40 },
  { slug: "ups-2-day", carrier: "UPS", name: "UPS 2nd Day Air", price: null, active: true, sortOrder: 50 },
  { slug: "ups-next-day", carrier: "UPS", name: "UPS Next Day Air", price: null, active: true, sortOrder: 60 },
].map((method) => (method.slug in prices ? { ...method, price: prices[method.slug] ?? null } : method));

const eggs = { name: "Black Copper Maran Hatching Eggs", category: "eggs" as const, shipping: [...DEFAULT_METHODS.eggs] };
const moreEggs = { name: "Ayam Cemani Hatching Eggs", category: "eggs" as const, shipping: [...DEFAULT_METHODS.eggs] };
const chicks = { name: "MARSBAR", category: "chicks" as const, shipping: [...DEFAULT_METHODS.chicks] };
const adult = { name: "Lavender Orpington", category: "adult" as const, shipping: [...DEFAULT_METHODS.adult] };

test("default assignments follow the farm's shipping rules", () => {
  assert.deepEqual(DEFAULT_METHODS.adult, ["usps-priority-express"]);
  assert.deepEqual(DEFAULT_METHODS.chicks, ["usps-priority", "usps-priority-express"]);
  assert.deepEqual(DEFAULT_METHODS.eggs, ["usps-priority", "ups-ground", "ups-3-day", "ups-2-day", "ups-next-day"]);
});

test("hatching eggs: all five egg methods assigned, only priced ones offered", () => {
  const offer = cartShipping([eggs], methods());
  assert.deepEqual(offer.options.map((o) => [o.slug, o.price]), [["usps-priority", 18]]);
  assert.deepEqual(offer.waiting.map((o) => o.slug), ["ups-ground", "ups-3-day", "ups-2-day", "ups-next-day"]);
  assert.equal(offer.reason, "");
});

test("unpriced and switched-off methods are hidden", () => {
  const priced = methods({ "ups-ground": 22.5, "ups-next-day": 95 });
  assert.deepEqual(cartShipping([eggs], priced).options.map((o) => o.slug), ["usps-priority", "ups-ground", "ups-next-day"]);
  const off = priced.map((m) => (m.slug === "ups-ground" ? { ...m, active: false } : m));
  assert.deepEqual(cartShipping([eggs], off).options.map((o) => o.slug), ["usps-priority", "ups-next-day"]);
  const freeIsAPrice = methods({ "ups-ground": 0 });
  assert.ok(cartShipping([eggs], freeIsAPrice).options.some((o) => o.slug === "ups-ground" && o.price === 0));
});

test("intersection: a cart only ships by methods every item allows", () => {
  const all = methods({ "usps-priority-express": 60, "ups-ground": 20 });
  assert.deepEqual(cartShipping([eggs, moreEggs], all).options.map((o) => o.slug), ["usps-priority", "ups-ground"]);
  // Chicks + eggs share only USPS Priority Mail.
  assert.deepEqual(cartShipping([eggs, chicks], all).options.map((o) => o.slug), ["usps-priority"]);
  // Chicks + adult share only Priority Mail Express.
  assert.deepEqual(cartShipping([chicks, adult], all).options.map((o) => o.slug), ["usps-priority-express"]);
  // Adult birds + eggs share nothing: pickup only, with a reason.
  const mixed = cartShipping([adult, eggs], all);
  assert.deepEqual(mixed.options, []);
  assert.equal(mixed.reason, "Adult birds and hatching eggs ship differently — place separate orders to ship both.");
});

test("live birds ship via Priority Mail Express once it has a price", () => {
  const before = cartShipping([adult], methods());
  assert.deepEqual(before.options, []);
  assert.match(before.reason, /Shipping rates for adult birds aren't set yet/);
  assert.match(before.reason, /Email farm@hoggs\.org to arrange shipping\./);
  assert.doesNotMatch(before.reason, /\d{3}-\d{4}/);
  assert.deepEqual(before.waiting.map((m) => m.slug), ["usps-priority-express"]);
  const after = cartShipping([adult], methods({ "usps-priority-express": 65 }));
  assert.deepEqual(after.options.map((o) => [o.slug, o.price]), [["usps-priority-express", 65]]);
});

test("chicks get Priority Mail with an Express upgrade", () => {
  const offer = cartShipping([chicks], methods({ "usps-priority-express": 55 }));
  assert.deepEqual(offer.options.map((o) => o.slug), ["usps-priority", "usps-priority-express"]);
});

test("a listing with no methods is pickup only and says so", () => {
  const offer = cartShipping([eggs, { ...adult, shipping: [] }], methods());
  assert.deepEqual(offer.options, []);
  assert.equal(offer.reason, "Lavender Orpington is farm pickup only.");
});

test("product assignment keeps known methods only, in table order", () => {
  const known = methods();
  assert.deepEqual(normalizeAssignedMethods(["ups-next-day", "bogus", "usps-priority", "usps-priority"], known), ["usps-priority", "ups-next-day"]);
  assert.deepEqual(normalizeAssignedMethods("usps-priority", known), []);
  assert.deepEqual(normalizeAssignedMethods([], known), []);
});

test("category guesses and kind mapping", () => {
  assert.equal(guessCategory("eggs", ["1 Dozen (12) Hatching Eggs"]), "eggs");
  assert.equal(guessCategory("birds", ["Day Old Chick Straight Run"]), "chicks");
  assert.equal(guessCategory("birds", ["6 Day Old Chicks Straight Run", "12 Day Old Chicks Straight Run"]), "chicks");
  assert.equal(guessCategory("birds", ["Standard"]), "adult");
  assert.equal(guessCategory("birds", ["Day Old Chick Straight Run", "4+ Month Cockerel/Pullet"]), "adult");
  assert.equal(guessCategory("birds", []), "adult");
  assert.equal(kindForCategory("chicks"), "birds");
  assert.equal(kindForCategory("adult"), "birds");
  assert.equal(kindForCategory("eggs"), "eggs");
  assert.equal(parseCategory("chicks"), "chicks");
  assert.equal(parseCategory("nonsense", "birds"), "adult");
  assert.equal(parseCategory(undefined, "eggs"), "eggs");
});

const line = { name: "Ayam Cemani Hatching Eggs", label: "1 Dozen (12) Hatching Eggs", price: 50, qty: 1, sku: "AC-1-DZN", kind: "eggs", slug: "ayam-cemani" };
const imported: StoredOrder = {
  method: "ship",
  shippingMethod: null, // imported history: method never recorded
  address: "123 Example Rd, Somewhere, TN 37000",
  subtotal: 50,
  shipping: 14.35, // whatever GoDaddy charged at the time
  tax: 0,
  total: 64.35,
  items: [line],
};

test("edit preserves stored totals when lines and method are unchanged", () => {
  const plan = planOrderEdit(imported, { method: "ship", shippingMethod: null, address: imported.address, items: [{ ...line }] }, { taxRate: 0.06, newShipping: null });
  assert.equal(plan.itemsChanged, false);
  assert.equal(plan.methodChanged, false);
  assert.deepEqual([plan.subtotal, plan.shipping, plan.tax, plan.total], [50, 14.35, 0, 64.35]);
  assert.equal(plan.address, imported.address);
});

test("edit never rewrites a stored pickup address", () => {
  const pickup: StoredOrder = { ...imported, method: "pickup", shipping: 0, total: 50, address: "45 Customer Ln, Shelbyville, KY 40065" };
  const blank = planOrderEdit(pickup, { method: "pickup", shippingMethod: null, address: "", items: [line] }, { taxRate: 0, newShipping: 0 });
  assert.equal(blank.address, "45 Customer Ln, Shelbyville, KY 40065");
  const kept = planOrderEdit(pickup, { method: "pickup", shippingMethod: null, address: pickup.address, items: [line] }, { taxRate: 0, newShipping: 0 });
  assert.equal(kept.address, pickup.address);
  assert.equal(kept.total, 50);
});

test("changing lines recomputes subtotal and tax but keeps the stored shipping", () => {
  const plan = planOrderEdit(imported, { method: "ship", shippingMethod: null, address: "", items: [{ ...line, qty: 2 }] }, { taxRate: 0.06, newShipping: null });
  assert.equal(plan.itemsChanged, true);
  assert.equal(plan.methodChanged, false);
  assert.deepEqual([plan.subtotal, plan.shipping, plan.tax, plan.total], [100, 14.35, 6, 120.35]);
});

test("changing the method takes the new method's price", () => {
  const plan = planOrderEdit(imported, { method: "ship", shippingMethod: "usps-priority", address: "", items: [line] }, { taxRate: 0.06, newShipping: 18 });
  assert.equal(plan.methodChanged, true);
  assert.deepEqual([plan.subtotal, plan.shipping, plan.tax, plan.total], [50, 18, 0, 68]);
  const toPickup = planOrderEdit(imported, { method: "pickup", shippingMethod: null, address: "", items: [line] }, { taxRate: 0.06, newShipping: 0 });
  assert.deepEqual([toPickup.shipping, toPickup.total, toPickup.address], [0, 50, imported.address]);
  assert.throws(
    () => planOrderEdit(imported, { method: "ship", shippingMethod: "usps-priority-express", address: "", items: [line] }, { taxRate: 0, newShipping: null }),
    /Set a price/,
  );
});

test("line comparison ignores order and float noise", () => {
  const two = { ...imported, items: [line, { ...line, slug: "b", name: "B", price: 30 }] };
  const plan = planOrderEdit(two, { method: "ship", shippingMethod: null, address: "", items: [{ ...line, slug: "b", name: "B", price: 30.000000001 }, line] }, { taxRate: 0.06, newShipping: null });
  assert.equal(plan.itemsChanged, false);
  assert.equal(plan.total, 64.35);
});
