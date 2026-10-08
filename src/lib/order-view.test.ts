/** Order view helpers: note parsing and the change-only patch the view sends. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Order } from "./farm-store";
import { blankDraft, buildPatch, draftFromOrder } from "./order-draft.ts";
import { parseOrderNote, trackingUrl } from "./order-note.ts";

const imported = [
  "Imported from GoDaddy order history. Sales channel: Online Store. Original order #R100000001.",
  "Original statuses: fulfillment Fulfilled, payment Paid.",
  "Refunded (GoDaddy payment status Refunded).",
  "Payment method: Credit/Debit Card - GoDaddy Payments",
  "Shipping method: USPS Priority Mail",
  "Tracking #: 9400100000000000000001",
  "Coupon: SPRING10 (Spring sale)",
  "Discount: $4.50",
  "Closed out, never paid.",
].join("\n");

test("imported notes become labelled fields plus free text", () => {
  const parsed = parseOrderNote(imported);
  assert.equal(parsed.imported, true);
  const byLabel = Object.fromEntries(parsed.fields.map((field) => [field.label, field.value]));
  assert.equal(byLabel["Sales channel"], "Online Store");
  assert.equal(byLabel["Original order #"], "R100000001");
  assert.equal(byLabel["Payment method"], "Credit/Debit Card - GoDaddy Payments");
  assert.equal(byLabel["Tracking #"], "9400100000000000000001");
  assert.equal(byLabel["Coupon"], "SPRING10 (Spring sale)");
  assert.equal(parsed.discount, 4.5);
  assert.deepEqual(parsed.text, ["Refunded (GoDaddy payment status Refunded).", "Closed out, never paid."]);
});

test("plain desk notes stay plain; times and links are not split into fields", () => {
  const parsed = parseOrderNote("Pickup at 10:30 Saturday\nhttps://example.com/photo\nCall first");
  assert.equal(parsed.imported, false);
  assert.deepEqual(parsed.fields, []);
  assert.equal(parsed.text.length, 3);
  assert.deepEqual(parseOrderNote(""), { imported: false, fields: [], text: [], discount: null });
});

test("tracking links for USPS and UPS numbers only", () => {
  assert.match(trackingUrl("9400100000000000000001") ?? "", /usps\.com/);
  assert.match(trackingUrl("1Z999AA10123456784") ?? "", /ups\.com/);
  assert.equal(trackingUrl("pickup"), null);
});

const order: Order = {
  id: "R1",
  created: "2024-01-01T00:00:00Z",
  customer: { name: "Ada Sample", email: "ada@example.com", phone: "" },
  method: "ship",
  shippingMethod: null,
  address: "1 Example Rd",
  payment: { type: "pay-at-pickup" },
  status: "completed",
  history: [],
  items: [{ key: "a", slug: "old", variantId: 0, name: "Old Eggs", label: "", price: 15, image: "", qty: 1, sku: "", kind: "eggs" }],
  totals: { sub: 15, ship: 18, tax: 0, total: 33 },
  note: "n",
};

test("the view sends only what changed", () => {
  const base = draftFromOrder(order);
  assert.equal(base.shipping, "legacy-ship");
  assert.deepEqual(buildPatch(base, { ...base }).patch, {});
  const statusOnly = buildPatch(base, { ...base, status: "cancelled", statusNote: " refunded " });
  assert.deepEqual(statusOnly.patch, { status: "cancelled", statusNote: "refunded" });
  assert.deepEqual(statusOnly.sections, ["status"]);
  // A status note alone (status unchanged) is not a change.
  assert.deepEqual(buildPatch(base, { ...base, statusNote: "x" }).patch, {});
  const qty = buildPatch(base, { ...base, items: base.items.map((item) => ({ ...item, qty: "2" })) });
  assert.deepEqual(qty.sections, ["items"]);
  assert.equal(qty.patch.items?.[0]?.qty, 2);
  // Typing the same price differently ("15.00") is not a change.
  assert.deepEqual(buildPatch(base, { ...base, items: base.items.map((item) => ({ ...item, price: "15.00" })) }).patch, {});
  assert.deepEqual(buildPatch(base, { ...base, email: "ADA@example.com" }).patch, {});
  assert.equal(blankDraft().items.length, 1);
});
