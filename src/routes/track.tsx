import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "@/components/shell";
import { hydrateFarm, money, statusLabel, useFarm } from "@/lib/farm-store";
import { trackOrder } from "@/lib/shop.functions";
import { OrderBody } from "./order.$id";

export const Route = createFileRoute("/track")({ component: TrackPage });

function TrackPage() {
  const farm = useFarm();
  const [ready, setReady] = useState(false);
  const [found, setFound] = useState<{ id: string; email: string } | null>(null);
  const [miss, setMiss] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    hydrateFarm();
    setReady(true);
  }, []);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = String(data.get("id") || "").trim();
    const email = String(data.get("email") || "").trim();
    setPending(true);
    setMiss(false);
    const order = await trackOrder({ data: { id, email } });
    setPending(false);
    if (!order) {
      setFound(null);
      setMiss(true);
      return;
    }
    setFound({ id: order.id, email });
  }
  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-widest text-barn">Orders</p>
      <h1 className="text-4xl">Track an order</h1>
      <form className="mt-4 max-w-xl rounded-card border border-line bg-paper p-4" onSubmit={onSubmit}>
        <label className="block text-sm font-semibold" htmlFor="id">Order number</label>
        <input id="id" name="id" required placeholder="HH-..." className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
        <label className="mt-3 block text-sm font-semibold" htmlFor="email">Email on the order</label>
        <input id="email" name="email" type="email" required className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
        <button type="submit" disabled={pending} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper disabled:opacity-60">
          {pending ? "Looking…" : "Look up"}
        </button>
      </form>
      {miss ? <p className="mt-4 max-w-xl rounded-xl bg-note-bg p-3 text-sm text-note">No order matches that number and email.</p> : null}
      {found ? <div className="mt-6"><OrderBody id={found.id} email={found.email} /></div> : null}
      {ready && farm.orders.length > 0 ? (
        <div className="mt-8">
          <h2 className="text-2xl">Orders on this browser</h2>
          <ul className="mt-2 space-y-2">
            {farm.orders.map((order) => (
              <li key={order.id}>
                <Link to="/order/$id" params={{ id: order.id }} className="font-semibold text-barn">{order.id}</Link>
                <span className="text-muted"> · {statusLabel(order.status)} · {money(order.totals.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Shell>
  );
}
