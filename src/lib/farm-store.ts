import { useSyncExternalStore } from "react";

export type CartItem = {
  key: string;
  slug: string;
  variantId: number;
  name: string;
  label: string;
  price: number;
  image: string;
  qty: number;
  sku: string;
  kind: "eggs" | "birds";
};

export type OrderStatus =
  | "awaiting-payment"
  | "paid"
  | "packing"
  | "shipped"
  | "ready-for-pickup"
  | "completed"
  | "cancelled";

export type Order = {
  id: string;
  created: string;
  customer: { name: string; email: string; phone: string };
  method: "pickup" | "ship";
  address: string;
  payment: { type: "card-sandbox"; last4: string; brand: string } | { type: "pay-at-pickup" };
  status: OrderStatus;
  history: { at: string; status: OrderStatus; note: string }[];
  items: CartItem[];
  totals: { sub: number; ship: number; tax: number; total: number };
  note: string;
};

export type Settings = { shipEggs: number; taxRate: number };

type FarmState = { cart: CartItem[]; orders: Order[]; settings: Settings };

const EMPTY: FarmState = {
  cart: [],
  orders: [],
  settings: { shipEggs: 18, taxRate: 0 },
};

const KEY = "hh-store-v1";
let state: FarmState = EMPTY;
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  listeners.forEach((listener) => listener());
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
}

function setState(next: FarmState) {
  state = next;
  emit();
}

export function hydrateFarm() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      emit();
      return;
    }
    const parsed = JSON.parse(raw) as Partial<FarmState>;
    state = {
      cart: Array.isArray(parsed.cart) ? parsed.cart : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      settings: {
        shipEggs: Number(parsed.settings?.shipEggs ?? EMPTY.settings.shipEggs) || 0,
        taxRate: Number(parsed.settings?.taxRate ?? EMPTY.settings.taxRate) || 0,
      },
    };
  } catch {
    state = EMPTY;
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFarm() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function cartCount(cart: CartItem[]) {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

export function cartTotals(cart: CartItem[], method: "pickup" | "ship", settings: Settings) {
  const sub = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const hasBirds = cart.some((item) => item.kind === "birds");
  const ship = method === "ship" && !hasBirds ? settings.shipEggs : 0;
  const tax = sub * settings.taxRate;
  return { sub, ship, tax, total: sub + ship + tax, hasBirds };
}

export function addToCart(item: Omit<CartItem, "key">) {
  const key = `${item.slug}:${item.variantId}`;
  const existing = state.cart.find((line) => line.key === key);
  const cart = existing
    ? state.cart.map((line) => (line.key === key ? { ...line, qty: line.qty + item.qty } : line))
    : [...state.cart, { ...item, key }];
  setState({ ...state, cart });
}

export function setQty(key: string, qty: number) {
  setState({
    ...state,
    cart: state.cart.map((line) => (line.key === key ? { ...line, qty: Math.max(1, qty) } : line)),
  });
}

export function removeLine(key: string) {
  setState({ ...state, cart: state.cart.filter((line) => line.key !== key) });
}

export function saveReceipt(order: Order) {
  setState({
    ...state,
    orders: [order, ...state.orders.filter((item) => item.id !== order.id)],
  });
}

export function clearCart() {
  setState({ ...state, cart: [] });
}

export function statusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    "awaiting-payment": "Awaiting payment",
    paid: "Paid",
    packing: "Packing",
    shipped: "Shipped",
    "ready-for-pickup": "Ready for pickup",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status];
}

export const ORDER_STATUSES: OrderStatus[] = [
  "awaiting-payment",
  "paid",
  "packing",
  "shipped",
  "ready-for-pickup",
  "completed",
  "cancelled",
];

