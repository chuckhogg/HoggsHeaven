import { useEffect, useState } from "react";
import type { Order, OrderStatus } from "@/lib/farm-store";
import { money, ORDER_STATUSES, statusLabel } from "@/lib/farm-store";
import { deleteOrder, listAdminOrders, saveOrder, saveShopSettings } from "@/lib/shop.functions";
import { useCatalog } from "@/lib/use-catalog";

const field = "mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3";

type Line = { name: string; label: string; price: string; qty: string; kind: "eggs" | "birds"; sku: string; image: string; slug: string };

type Draft = {
  id: string;
  name: string;
  email: string;
  phone: string;
  method: "pickup" | "ship";
  address: string;
  status: OrderStatus;
  note: string;
  items: Line[];
};

function blankLine(): Line {
  return { name: "", label: "", price: "", qty: "1", kind: "eggs", sku: "", image: "", slug: "" };
}

function fromOrder(order: Order): Draft {
  return {
    id: order.id,
    name: order.customer.name,
    email: order.customer.email,
    phone: order.customer.phone,
    method: order.method,
    address: order.address,
    status: order.status,
    note: order.note,
    items: order.items.map((item) => ({
      name: item.name,
      label: item.label,
      price: String(item.price),
      qty: String(item.qty),
      kind: item.kind,
      sku: item.sku,
      image: item.image,
      slug: item.slug,
    })),
  };
}

export function AdminOrders() {
  const catalog = useCatalog();
  const [orders, setOrders] = useState<Order[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [shipEggs, setShipEggs] = useState("18");
  const [taxRate, setTaxRate] = useState("0");

  async function reload() {
    const next = await listAdminOrders();
    setOrders(next);
    setReady(true);
  }

  useEffect(() => {
    void reload().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Orders did not load."));
  }, []);

  useEffect(() => {
    setShipEggs(String(catalog.settings.shipEggs));
    setTaxRate(String(catalog.settings.taxRate));
  }, [catalog.settings]);

  async function onSave() {
    if (!draft) return;
    setMessage("");
    try {
      await saveOrder({
        data: {
          id: draft.id || undefined,
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          method: draft.method,
          address: draft.address,
          status: draft.status,
          note: draft.note,
          items: draft.items.map((item) => ({
            name: item.name,
            label: item.label || item.name,
            price: Number(item.price),
            qty: Number(item.qty),
            kind: item.kind,
            sku: item.sku,
            image: item.image,
            slug: item.slug,
          })),
        },
      });
      setDraft(null);
      await reload();
      setMessage("Order saved. No card number is stored.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That order did not save.");
    }
  }

  async function onDelete(order: Order) {
    if (!confirm(`Delete order ${order.id}?`)) return;
    await deleteOrder({ data: { id: order.id } });
    await reload();
    setMessage("Order deleted.");
  }

  return (
    <div>
      <h2 className="text-3xl">Orders</h2>
      <form
        className="mt-4 rounded-card border border-line bg-paper p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void saveShopSettings({ data: { shipEggs: Number(shipEggs), taxRate: Number(taxRate) } })
            .then(() => catalog.reload())
            .then(() => setMessage("Shipping and tax saved."))
            .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Settings did not save."));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold" htmlFor="ship">Egg shipping flat rate</label>
            <input id="ship" type="number" min={0} step="0.01" value={shipEggs} onChange={(event) => setShipEggs(event.target.value)} className={field} />
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="tax">Tax rate (0.06 = 6%)</label>
            <input id="tax" type="number" min={0} max={0.25} step="0.001" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} className={field} />
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">
          Card numbers, expiration dates, and security codes are not collected or stored. Take a card on Stripe or Square, then mark the order paid here.
        </p>
        <button type="submit" className="mt-3 inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold">Save rates</button>
      </form>
      <button
        type="button"
        className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper"
        onClick={() => setDraft({ id: "", name: "", email: "", phone: "", method: "pickup", address: "", status: "awaiting-payment", note: "", items: [blankLine()] })}
      >
        Add order
      </button>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      {!ready ? <p className="mt-4 text-muted">Loading orders…</p> : null}
      {ready && orders.length === 0 ? <p className="mt-4">No orders yet.</p> : null}
      <div className="mt-4 space-y-3">
        {orders.map((order) => (
          <article key={order.id} className="rounded-card border border-line bg-paper p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <strong>{order.id}</strong>
                <p className="text-sm text-muted">{new Date(order.created).toLocaleString()} · {order.customer.name} · {order.customer.email}</p>
                <p className="text-sm">{statusLabel(order.status)} · {money(order.totals.total)} · {order.method === "ship" ? "Ship" : "Pickup"}</p>
              </div>
              <div className="flex gap-3">
                <button type="button" className="font-semibold text-barn" onClick={() => setDraft(fromOrder(order))}>Edit</button>
                <button type="button" className="font-semibold" onClick={() => void onDelete(order)}>Delete</button>
              </div>
            </div>
            <ul className="mt-2 text-sm text-muted">
              {order.items.map((item) => (
                <li key={item.key}>{item.name} · {item.label} × {item.qty}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {draft ? (
        <form
          className="mt-4 rounded-card border border-line bg-paper p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave();
          }}
        >
          <h3 className="text-2xl">{draft.id ? `Edit ${draft.id}` : "New order"}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="cname">Name</label>
              <input id="cname" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={field} />
            </div>
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="cemail">Email</label>
              <input id="cemail" type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className={field} />
            </div>
          </div>
          <label className="mt-3 block text-sm font-semibold" htmlFor="cphone">Phone</label>
          <input id="cphone" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className={field} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="method">Fulfillment</label>
              <select id="method" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value as Draft["method"] })} className={field}>
                <option value="pickup">Farm pickup</option>
                <option value="ship">Ship hatching eggs</option>
              </select>
            </div>
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="status">Status</label>
              <select id="status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as OrderStatus })} className={field}>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            </div>
          </div>
          {draft.method === "ship" ? (
            <>
              <label className="mt-3 block text-sm font-semibold" htmlFor="address">Address</label>
              <input id="address" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} className={field} />
            </>
          ) : null}
          <label className="mt-3 block text-sm font-semibold" htmlFor="note">Note</label>
          <textarea id="note" rows={2} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className={field} />
          <p className="mt-4 text-sm font-semibold">Lines</p>
          {draft.items.map((item, index) => (
            <div key={index} className="mt-2 grid gap-2 sm:grid-cols-4">
              <input aria-label="Line name" placeholder="Bird or eggs" value={item.name} onChange={(event) => setDraft({ ...draft, items: draft.items.map((line, i) => i === index ? { ...line, name: event.target.value } : line) })} className={field} />
              <input aria-label="Line price" placeholder="Price" inputMode="decimal" value={item.price} onChange={(event) => setDraft({ ...draft, items: draft.items.map((line, i) => i === index ? { ...line, price: event.target.value } : line) })} className={field} />
              <input aria-label="Line quantity" placeholder="Qty" inputMode="numeric" value={item.qty} onChange={(event) => setDraft({ ...draft, items: draft.items.map((line, i) => i === index ? { ...line, qty: event.target.value } : line) })} className={field} />
              <select aria-label="Line kind" value={item.kind} onChange={(event) => setDraft({ ...draft, items: draft.items.map((line, i) => i === index ? { ...line, kind: event.target.value as Line["kind"] } : line) })} className={field}>
                <option value="eggs">Eggs</option>
                <option value="birds">Birds</option>
              </select>
            </div>
          ))}
          <button type="button" className="mt-3 text-sm font-semibold text-barn" onClick={() => setDraft({ ...draft, items: [...draft.items, blankLine()] })}>Add line</button>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">Save order</button>
            <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
