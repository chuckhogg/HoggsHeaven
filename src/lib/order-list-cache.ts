import type { Order } from "./farm-store";

// The desk's order list, kept between visits so "back to all orders" paints
// immediately (and keeps its scroll position) while a fresh copy loads.
let cached: Order[] | null = null;

export function cachedOrderList() {
  return cached;
}

export function setCachedOrderList(orders: Order[]) {
  cached = orders;
}

/** Patch the cached list after an order is saved, created, or deleted in the order view. */
export function invalidateOrderList(updated?: Order, removedId?: string) {
  if (!cached) return;
  if (removedId) cached = cached.filter((order) => order.id !== removedId);
  if (updated) {
    const found = cached.some((order) => order.id === updated.id);
    cached = found ? cached.map((order) => (order.id === updated.id ? updated : order)) : [updated, ...cached];
  }
}

/** Date (+ time) in the browser's zone, short. */
export function when(iso: string, withTime = true) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(
    "en-US",
    withTime
      ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}
