import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Order, OrderStatus } from "@/lib/farm-store";
import { fulfillmentLabel, money, ORDER_STATUSES, statusLabel } from "@/lib/farm-store";
import { listAdminOrders, saveShopSettings } from "@/lib/shop.functions";
import { useCatalog } from "@/lib/use-catalog";
import { cachedOrderList, setCachedOrderList, when } from "@/lib/order-list-cache";
import { StatusPill } from "./order-bits";

const field = "mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3";

export function AdminOrders() {
  const catalog = useCatalog();
  const [orders, setOrders] = useState<Order[]>(() => cachedOrderList() ?? []);
  const [ready, setReady] = useState(() => cachedOrderList() !== null);
  const [message, setMessage] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");

  useEffect(() => {
    let live = true;
    listAdminOrders()
      .then((next) => {
        if (!live) return;
        setCachedOrderList(next);
        setOrders(next);
        setReady(true);
      })
      .catch((err: unknown) => live && setMessage(err instanceof Error ? err.message : "Orders did not load."));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setTaxRate(String(catalog.settings.taxRate));
  }, [catalog.settings]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (status !== "all" && order.status !== status) return false;
      if (!q) return true;
      return [order.id, order.customer.name, order.customer.email, order.customer.phone, ...order.items.map((item) => item.name)]
        .some((value) => value.toLowerCase().includes(q));
    });
  }, [orders, query, status]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl">Orders</h2>
        <Link to="/admin/orders/$id" params={{ id: "new" }} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-barn px-5 font-semibold text-paper">
          <Plus className="size-4" aria-hidden /> Add order
        </Link>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="relative block">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order #, name, email, item"
            className="w-full rounded-xl border border-line bg-paper py-3 pl-9 pr-3"
          />
        </label>
        <label className="block">
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as OrderStatus | "all")} className="w-full rounded-xl border border-line bg-paper px-3 py-3 sm:w-56">
            <option value="all">All statuses</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>{statusLabel(value)}</option>
            ))}
          </select>
        </label>
      </div>

      {message ? <p className="mt-3 text-sm text-barn">{message}</p> : null}
      {!ready && !message ? <p className="mt-4 text-muted">Loading orders…</p> : null}
      {ready && orders.length === 0 ? <p className="mt-4">No orders yet.</p> : null}
      {ready && orders.length > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {shown.length === orders.length ? `${orders.length} orders` : `${shown.length} of ${orders.length} orders`} · click an order to open it
        </p>
      ) : null}

      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-paper" aria-label="Orders">
        {shown.map((order) => (
          <li key={order.id}>
            <Link
              to="/admin/orders/$id"
              params={{ id: order.id }}
              className="group grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-cream focus-visible:bg-cream focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-barn"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong className="font-mono text-sm">{order.id}</strong>
                  <StatusPill status={order.status} />
                  <span className="text-sm text-muted">{when(order.created, false)}</span>
                </div>
                <p className="mt-1 truncate">
                  <span className="font-semibold">{order.customer.name}</span>
                  <span className="text-muted"> · {order.customer.email}</span>
                </p>
                <p className="truncate text-sm text-muted">
                  {order.items.map((item) => `${item.name}${item.qty > 1 ? ` × ${item.qty}` : ""}`).join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-2 text-right">
                <div>
                  <p className="font-semibold">{money(order.totals.total)}</p>
                  <p className="text-xs text-muted">{fulfillmentLabel(order)}</p>
                </div>
                <ChevronRight className="size-5 text-muted group-hover:text-barn" aria-hidden />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {ready && orders.length > 0 && shown.length === 0 ? <p className="mt-3 text-muted">No orders match.</p> : null}

      <details className="mt-6 rounded-card border border-line bg-paper p-4">
        <summary className="cursor-pointer font-semibold">Tax rate and payments</summary>
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveShopSettings({ data: { taxRate: Number(taxRate) } })
              .then(() => catalog.reload())
              .then(() => setMessage("Tax rate saved."))
              .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Settings did not save."));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold" htmlFor="tax">Tax rate (0.06 = 6%)</label>
              <input id="tax" type="number" min={0} max={0.25} step="0.001" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} className={field} />
            </div>
            <p className="self-end text-sm text-muted">Shipping prices are set per method on the Shipping tab.</p>
          </div>
          <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">
            Card numbers, expiration dates, and security codes are not collected or stored. Take a card on Stripe or Square, then mark the order paid here.
          </p>
          <button type="submit" className="mt-3 inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold">Save tax rate</button>
        </form>
      </details>
    </div>
  );
}
