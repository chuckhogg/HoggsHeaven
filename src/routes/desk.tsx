import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "@/components/shell";
import { hydrateFarm, money, ORDER_STATUSES, saveSettings, statusLabel, updateOrder, useFarm, type OrderStatus } from "@/lib/farm-store";

export const Route = createFileRoute("/desk")({ component: DeskPage });

function DeskPage() {
  const farm = useFarm();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [shipEggs, setShipEggs] = useState("18");
  const [taxRate, setTaxRate] = useState("0");
  const [code, setCode] = useState("heaven");
  const [drafts, setDrafts] = useState<Record<string, OrderStatus>>({});
  useEffect(() => {
    hydrateFarm();
    setReady(true);
    setOpen(sessionStorage.getItem("hh-desk") === "1");
  }, []);
  useEffect(() => {
    setShipEggs(String(farm.settings.shipEggs));
    setTaxRate(String(farm.settings.taxRate));
    setCode(farm.settings.deskCode);
  }, [farm.settings]);

  function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entered = String(new FormData(event.currentTarget).get("code") || "");
    if (entered === farm.settings.deskCode) {
      sessionStorage.setItem("hh-desk", "1");
      setOpen(true);
      setError(false);
    } else setError(true);
  }

  if (!ready) {
    return <Shell><p className="text-muted">Opening the desk…</p></Shell>;
  }
  if (!open) {
    return (
      <Shell>
        <h1 className="text-4xl">Farm desk</h1>
        <p className="mt-2 max-w-lg text-muted">Update payment and shipping. The starting code is heaven. Change it after you sign in.</p>
        <form className="mt-4 max-w-md rounded-card border border-line bg-paper p-4" onSubmit={unlock}>
          <label className="text-sm font-semibold" htmlFor="code">Desk code</label>
          <input id="code" name="code" type="password" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          <button type="submit" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">Open desk</button>
          {error ? <p className="mt-3 text-sm text-barn">Wrong code.</p> : null}
        </form>
      </Shell>
    );
  }
  return (
    <Shell>
      <h1 className="text-4xl">Orders</h1>
      <div className="mt-4 rounded-card border border-line bg-paper p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold" htmlFor="ship">Egg shipping flat rate</label>
            <input id="ship" type="number" step="0.01" value={shipEggs} onChange={(event) => setShipEggs(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="tax">Tax rate (0.06 = 6%)</label>
            <input id="tax" type="number" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          </div>
        </div>
        <label className="mt-3 block text-sm font-semibold" htmlFor="deskCode">New desk code</label>
        <input id="deskCode" value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
        <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">Live card charges need a Stripe account. Until then, card checkout records a paid sandbox order, and pay-at-pickup stays unpaid until you mark it here.</p>
        <button
          type="button"
          className="mt-3 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper"
          onClick={() => saveSettings({ shipEggs: Number(shipEggs) || 0, taxRate: Number(taxRate) || 0, deskCode: code || "heaven" })}
        >
          Save desk settings
        </button>
        <button
          type="button"
          className="ml-2 mt-3 inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold"
          onClick={() => {
            const blob = new Blob([JSON.stringify(farm.orders, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "hoggs-heaven-orders.json";
            anchor.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download orders
        </button>
      </div>
      {farm.orders.length === 0 ? <p className="mt-6">No orders yet. Place a test checkout to see tracking.</p> : (
        <div className="mt-4 overflow-x-auto rounded-card border border-line bg-paper">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="p-3">Order</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Total</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {farm.orders.map((order) => (
                <tr key={order.id} className="border-b border-line align-top">
                  <td className="p-3">
                    <Link to="/order/$id" params={{ id: order.id }} className="font-semibold text-barn">{order.id}</Link>
                    <div className="text-muted">{new Date(order.created).toLocaleString()}</div>
                  </td>
                  <td className="p-3">{order.customer.name}<div className="text-muted">{order.customer.email}</div></td>
                  <td className="p-3">{money(order.totals.total)}<div className="text-muted">{order.payment.type === "card-sandbox" ? "Card sandbox" : "Pay at pickup"}</div></td>
                  <td className="p-3">
                    <select
                      aria-label={`Status for ${order.id}`}
                      className="rounded-lg border border-line bg-cream px-2 py-2"
                      value={drafts[order.id] ?? order.status}
                      onChange={(event) => setDrafts({ ...drafts, [order.id]: event.target.value as OrderStatus })}
                    >
                      {ORDER_STATUSES.map((status) => (
                        <option key={status} value={status}>{statusLabel(status)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <button type="button" className="font-semibold text-barn" onClick={() => updateOrder(order.id, drafts[order.id] ?? order.status)}>
                      Update
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
