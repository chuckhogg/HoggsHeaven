import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Shell } from "@/components/shell";
import { cartTotals, clearCart, hydrateFarm, money, saveReceipt, useFarm } from "@/lib/farm-store";
import { placeShopOrder } from "@/lib/shop.functions";
import { useCatalog } from "@/lib/use-catalog";

export const Route = createFileRoute("/checkout")({ component: CheckoutPage });

function CheckoutPage() {
  const farm = useFarm();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [method, setMethod] = useState<"pickup" | "ship">("pickup");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const placed = useRef(false);
  useEffect(() => {
    hydrateFarm();
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready && farm.cart.length === 0 && !placed.current) navigate({ to: "/cart" });
  }, [ready, farm.cart.length, navigate]);
  const totals = cartTotals(farm.cart, method, catalog.settings);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const street = String(data.get("street") || "").trim();
    const city = String(data.get("city") || "").trim();
    const region = String(data.get("region") || "").trim();
    const zip = String(data.get("zip") || "").trim();
    const note = String(data.get("note") || "").trim();
    if (method === "ship" && totals.hasBirds) {
      setError("Live birds are pickup only. Switch to farm pickup or remove chicks.");
      return;
    }
    if (method === "ship" && !street) {
      setError("Add a shipping address for hatching eggs.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const order = await placeShopOrder({
        data: {
          customer: { name, email, phone },
          method,
          address: method === "ship" ? `${street}, ${city}, ${region} ${zip}` : "",
          note,
          items: farm.cart.map((line) => ({ slug: line.slug, variantId: line.variantId, qty: line.qty })),
        },
      });
      placed.current = true;
      saveReceipt(order);
      clearCart();
      await navigate({ to: "/order/$id", params: { id: order.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The order did not save.");
      setPending(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <form className="rounded-card border border-line bg-paper p-5" onSubmit={onSubmit}>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">Checkout</p>
          <h1 className="mt-1 text-4xl">Pickup and shipping</h1>
          <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">
            This page never asks for a card number, expiration date, or security code. Pay at the farm, or we will invoice you. Card charges stay on Stripe or Square, then the farm marks the order paid.
          </p>
          <label className="mt-4 block text-sm font-semibold" htmlFor="name">Full name</label>
          <input id="name" name="name" required autoComplete="name" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
            </div>
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="phone">Phone</label>
              <input id="phone" name="phone" required autoComplete="tel" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
            </div>
          </div>
          <label className="mt-3 block text-sm font-semibold" htmlFor="method">How do you want it?</label>
          <select id="method" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" value={method} onChange={(event) => setMethod(event.target.value as "pickup" | "ship")}>
            <option value="pickup">Farm pickup in Shelbyville — free</option>
            <option value="ship">Ship hatching eggs — {money(catalog.settings.shipEggs)}</option>
          </select>
          {method === "ship" ? (
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="street">Street</label>
              <input id="street" name="street" autoComplete="street-address" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mt-3 block text-sm font-semibold" htmlFor="city">City</label>
                  <input id="city" name="city" autoComplete="address-level2" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
                </div>
                <div>
                  <label className="mt-3 block text-sm font-semibold" htmlFor="region">State</label>
                  <input id="region" name="region" defaultValue="KY" autoComplete="address-level1" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
                </div>
              </div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="zip">ZIP</label>
              <input id="zip" name="zip" autoComplete="postal-code" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
            </div>
          ) : null}
          <label className="mt-3 block text-sm font-semibold" htmlFor="note">Note for the farm</label>
          <textarea id="note" name="note" rows={3} className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" placeholder="Pickup day or hatch questions" />
          {error ? <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">{error}</p> : null}
          {method === "ship" && totals.hasBirds ? <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">Live birds are pickup only.</p> : null}
          <button type="submit" disabled={pending} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper disabled:opacity-60">
            {pending ? "Placing order…" : "Place order"}
          </button>
        </form>
        <aside className="rounded-card border border-line bg-paper p-5">
          <h2 className="text-2xl">Order</h2>
          {farm.cart.map((line) => (
            <div key={line.key} className="grid grid-cols-[4rem_1fr_auto] gap-3 border-b border-line py-3">
              <img src={line.image} alt="" className="size-16 rounded-xl object-cover" />
              <div>
                <strong>{line.name}</strong>
                <p className="text-sm text-muted">{line.label} × {line.qty}</p>
              </div>
              <span>{money(line.price * line.qty)}</span>
            </div>
          ))}
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(totals.sub)}</span></div>
            <div className="flex justify-between"><span>Shipping</span><span>{money(totals.ship)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>{money(totals.tax)}</span></div>
            <div className="flex justify-between text-lg font-semibold"><span>Due</span><span>{money(totals.total)}</span></div>
          </div>
          <p className="mt-3 text-sm text-muted">Payment is due at pickup or by invoice. Nothing here stores a card.</p>
        </aside>
      </div>
    </Shell>
  );
}
