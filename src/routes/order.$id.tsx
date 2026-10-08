import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "@/components/shell";
import { fulfillmentLabel, hydrateFarm, money, saveReceipt, statusLabel, useFarm } from "@/lib/farm-store";
import { trackOrder } from "@/lib/shop.functions";

export const Route = createFileRoute("/order/$id")({ component: OrderPage });

export function OrderBody({ id, email }: { id: string; email?: string }) {
  const farm = useFarm();
  const [ready, setReady] = useState(false);
  const [typed, setTyped] = useState(email ?? "");
  const [miss, setMiss] = useState(false);
  useEffect(() => {
    hydrateFarm();
    setReady(true);
  }, []);
  const local = farm.orders.find((item) => item.id.toLowerCase() === id.toLowerCase());
  const lookupEmail = typed || local?.customer.email || "";

  const hasLocal = Boolean(local);

  useEffect(() => {
    if (!lookupEmail) return;
    let live = true;
    trackOrder({ data: { id, email: lookupEmail } })
      .then((order) => {
        if (!live) return;
        if (order) {
          saveReceipt(order);
          setMiss(false);
        } else if (!hasLocal) setMiss(true);
      })
      .catch(() => {
        if (live && !hasLocal) setMiss(true);
      });
    return () => {
      live = false;
    };
  }, [id, lookupEmail, hasLocal]);

  const order = farm.orders.find((item) => item.id.toLowerCase() === id.toLowerCase());
  if (!ready) return <p className="text-muted">Looking up the order…</p>;
  if (!order) {
    return (
      <div>
        <h1 className="text-4xl">Find this order</h1>
        <p className="mt-3 max-w-xl text-muted">Enter the email used at checkout. The order number alone is not enough.</p>
        <form
          className="mt-4 max-w-md"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget as HTMLFormElement);
            setTyped(String(data.get("email") || ""));
          }}
        >
          <label className="text-sm font-semibold" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          <button type="submit" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">Look up</button>
        </form>
        {miss ? <p className="mt-3 text-sm text-barn">No order matches that email.</p> : null}
        <Link to="/track" className="mt-4 inline-flex font-semibold text-barn">Track</Link>
      </div>
    );
  }
  return (
    <div>
      <div className="rounded-xl border border-moss/30 bg-paper p-4">
        <strong>{order.id}</strong> is {statusLabel(order.status)}. Saved for {order.customer.email}.
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-paper p-4">
          <h2 className="text-2xl">Receipt</h2>
          {order.items.map((line) => (
            <div key={line.key} className="grid grid-cols-[4rem_1fr_auto] gap-3 border-b border-line py-3">
              <img src={line.image} alt="" className="size-16 rounded-xl object-cover" />
              <div>
                <strong>{line.name}</strong>
                <p className="text-sm text-muted">{line.label} × {line.qty}</p>
              </div>
              <span>{money(line.price * line.qty)}</span>
            </div>
          ))}
          <div className="mt-3 flex justify-between text-sm"><span>{fulfillmentLabel(order)}</span><span>{money(order.totals.ship)}</span></div>
          {order.totals.tax ? <div className="flex justify-between text-sm"><span>Tax</span><span>{money(order.totals.tax)}</span></div> : null}
          <div className="mt-1 flex justify-between font-semibold"><span>Total</span><span>{money(order.totals.total)}</span></div>
          <p className="mt-2 text-sm text-muted">
            {order.status === "awaiting-payment" ? "Payment due at pickup or by invoice." : "Payment recorded by the farm."} No card number is stored. · {fulfillmentLabel(order)}
          </p>
          <p className="text-sm">{order.address}</p>
          <button type="button" className="mt-3 text-sm font-semibold text-barn" onClick={() => window.print()}>Print receipt</button>
        </div>
        <div className="rounded-card border border-line bg-paper p-4">
          <h2 className="text-2xl">Status</h2>
          <ol className="mt-3 space-y-3 border-l-2 border-moss pl-4">
            {order.history.map((entry) => (
              <li key={entry.at + entry.status}>
                <strong>{statusLabel(entry.status)}</strong>
                <p className="text-sm text-muted">{new Date(entry.at).toLocaleString()} · {entry.note}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-muted">{order.customer.name} · {order.customer.phone}</p>
          {order.note ? <p className="mt-2 text-sm">Note: {order.note}</p> : null}
        </div>
      </div>
    </div>
  );
}

function OrderPage() {
  const { id } = Route.useParams();
  return (
    <Shell>
      <OrderBody id={id} />
    </Shell>
  );
}
