/**
 * Order view draft state (pure; browser + tests).
 *
 * The order view keeps an editable copy of the order and sends the server only
 * what changed (`buildPatch`), so untouched fields are never re-validated or
 * rewritten. No path aliases: node's test runner imports this directly.
 */
import type { Order, OrderStatus } from "./farm-store";

export type LineDraft = {
  name: string;
  label: string;
  price: string;
  qty: string;
  sku: string;
  image: string;
  kind: "eggs" | "birds";
  slug: string;
  variantId: number | null;
};

export type OrderDraft = {
  name: string;
  email: string;
  phone: string;
  /** "pickup", a shipping method slug, or "legacy-ship" for an older order whose method was never recorded. */
  shipping: string;
  address: string;
  status: OrderStatus;
  statusNote: string;
  note: string;
  items: LineDraft[];
};

export type Section = "status" | "customer" | "fulfillment" | "items" | "notes";

export function shippingChoice(order: Pick<Order, "method" | "shippingMethod">) {
  return order.method === "pickup" ? "pickup" : order.shippingMethod?.slug ?? "legacy-ship";
}

export function blankLine(): LineDraft {
  return { name: "", label: "", price: "", qty: "1", sku: "", image: "", kind: "eggs", slug: "", variantId: null };
}

export function draftFromOrder(order: Order): OrderDraft {
  return {
    name: order.customer.name,
    email: order.customer.email,
    phone: order.customer.phone,
    shipping: shippingChoice(order),
    address: order.address,
    status: order.status,
    statusNote: "",
    note: order.note,
    items: order.items.map((item) => ({
      name: item.name,
      label: item.label,
      price: String(item.price),
      qty: String(item.qty),
      sku: item.sku,
      image: item.image,
      kind: item.kind,
      slug: item.slug,
      variantId: item.variantId ? item.variantId : null,
    })),
  };
}

export function blankDraft(): OrderDraft {
  return {
    name: "",
    email: "",
    phone: "",
    shipping: "pickup",
    address: "",
    status: "awaiting-payment",
    statusNote: "",
    note: "",
    items: [blankLine()],
  };
}

/** Lines as the server expects them (numbers parsed; the server re-validates). */
export function linesForSave(items: LineDraft[]) {
  return items.map((item) => ({
    name: item.name.trim(),
    label: item.label.trim(),
    price: Number(item.price),
    qty: Number(item.qty),
    sku: item.sku,
    image: item.image,
    kind: item.kind,
    slug: item.slug,
    variantId: item.variantId,
  }));
}

function lineSig(item: LineDraft) {
  return JSON.stringify([
    item.name.trim(),
    item.label.trim(),
    Math.round(Number(item.price) * 100),
    Number(item.qty),
    item.sku,
    item.kind,
    item.slug,
  ]);
}

export function sameDraftLines(a: LineDraft[], b: LineDraft[]) {
  return a.length === b.length && a.every((item, index) => lineSig(item) === lineSig(b[index] as LineDraft));
}

export type OrderPatchBody = {
  name?: string;
  email?: string;
  phone?: string;
  shipping?: string;
  address?: string;
  status?: OrderStatus;
  statusNote?: string;
  note?: string;
  items?: ReturnType<typeof linesForSave>;
};

/** Only what the desk changed, plus which sections those changes belong to. */
export function buildPatch(base: OrderDraft, draft: OrderDraft): { patch: OrderPatchBody; sections: Section[] } {
  const patch: OrderPatchBody = {};
  const sections = new Set<Section>();
  if (draft.name.trim() !== base.name.trim()) {
    patch.name = draft.name.trim();
    sections.add("customer");
  }
  if (draft.email.trim().toLowerCase() !== base.email.trim().toLowerCase()) {
    patch.email = draft.email.trim();
    sections.add("customer");
  }
  if (draft.phone.trim() !== base.phone.trim()) {
    patch.phone = draft.phone.trim();
    sections.add("customer");
  }
  if (draft.shipping !== base.shipping) {
    patch.shipping = draft.shipping;
    sections.add("fulfillment");
  }
  if (draft.address.trim() !== base.address.trim()) {
    patch.address = draft.address.trim();
    sections.add("fulfillment");
  }
  if (draft.status !== base.status) {
    patch.status = draft.status;
    if (draft.statusNote.trim()) patch.statusNote = draft.statusNote.trim();
    sections.add("status");
  }
  if (draft.note !== base.note) {
    patch.note = draft.note;
    sections.add("notes");
  }
  if (!sameDraftLines(base.items, draft.items)) {
    patch.items = linesForSave(draft.items);
    sections.add("items");
  }
  return { patch, sections: [...sections] };
}

export const SECTION_LABEL: Record<Section, string> = {
  status: "status",
  customer: "customer",
  fulfillment: "fulfillment",
  items: "line items",
  notes: "notes",
};
