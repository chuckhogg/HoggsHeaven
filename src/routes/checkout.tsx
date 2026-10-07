import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "@/components/shell";
import { cardBrand, cartTotals, hydrateFarm, luhn, money, placeOrder, useFarm } from "@/lib/farm-store";

export const Route = createFileRoute("/checkout")({ component: CheckoutPage });

function CheckoutPage() {
  const farm = useFarm();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [method, setMethod] = useState<"pickup" | "ship">("pickup");
  const [pay, setPay] = useState<"card" | "pickup">("card");
  const [error, setError] = useState("");
  useEffect(() => {
    hydrateFarm();
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready && farm.cart.length === 0) navigate({ to: "/cart" });
  }, [ready, farm.cart.length, navigate]);
  const totals = cartTotals(farm.cart, method, farm.settings);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const street = String(data.get("street") || "").trim();
    const city = String(data.get("city") || "").trim();
    const region = String(data.get("region") || "").trim();
    const zip = String(data.get("zip") || "").trim();
    const card = String(data.get("card") || "");
    const note = String(data.get("note") || "").trim();
    if (method === "ship" && totals.hasBirds) {
      setError("Live birds are pickup only. Switch to farm pickup or remove chicks.");
      return;
    }
    if (method === "ship" && !street) {
      setError("Add a shipping address for hatching eggs.");
      return;
    }
    if (pay === "card" && !luhn(card)) {
      setError("That card number did not pass a basic check. Use 4242 4242 4242 4242 to record a sandbox payment, or choose pay at pickup.");
      return;
    }
    const id = placeOrder({
      customer: { name, email, phone },
      method,
      address: method === "ship" ? `${street}, ${city}, ${region} ${zip}` : "Farm pickup, Shelbyville, KY 40065",
      payment: pay === "card"
        ? { type: "card-sandbox", last4: card.replace(/\D/g, "").slice(-4), brand: cardBrand(card) }
        : { type: "pay-at-pickup" },
      status: pay === "card" ? "paid" : "awaiting-payment",
      items: farm.cart.map((line) => ({ ...line })),
      totals,
      note,
    });
    navigate({ to: "/order/$id", params: { id } });
  }

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <form className="rounded-card border border-line bg-paper p-5" onSubmit={onSubmit}>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">Checkout</p>
          <h1 className="mt-1 text-4xl">Pickup, shipping, payment</h1>
          <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">
            Card numbers are checked here and only the last four digits are saved. This store does not charge a real card until Stripe is connected. Pickup orders stay unpaid until you mark them paid at the farm desk.
          </p>
          <label className="mt-4 block text-sm font-semibold" htmlFor="name">Full name</label>
          <input id="name" name="name" required className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
            </div>
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="phone">Phone</label>
              <input id="phone" name="phone" required className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
            </div>
          </div>
          <label className="mt-3 block text-sm font-semibold" htmlFor="method">How do you want it?</label>
          <select id="method" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" value={method} onChange={(event) => setMethod(event.target.value as "pickup" | "ship")}>
            <option value="pickup">Farm pickup in Shelbyville — free</option>
            <option value="ship">Ship hatching eggs — {money(farm.settings.shipEggs)}</option>
          </select>
          {method === "ship" ? (
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="street">Street</label>
              <input id="street" name="street" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mt-3 block text-sm font-semibold" htmlFor="city">City</label>
                  <input id="city" name="city" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
                </div>
                <div>
                  <label className="mt-3 block text-sm font-semibold" htmlFor="region">State</label>
                  <input id="region" name="region" defaultValue="KY" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
                </div>
              </div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="zip">ZIP</label>
              <input id="zip" name="zip" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
            </div>
          ) : null}
          <label className="mt-3 block text-sm font-semibold" htmlFor="pay">Payment</label>
          <select id="pay" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" value={pay} onChange={(event) => setPay(event.target.value as "card" | "pickup")}>
            <option value="card">Card — sandbox until Stripe is connected</option>
            <option value="pickup">Pay at pickup</option>
          </select>
          {pay === "card" ? (
            <div>
              <label className="mt-3 block text-sm font-semibold" htmlFor="card">Card number</label>
              <input id="card" name="card" inputMode="numeric" placeholder="4242 4242 4242 4242" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mt-3 block text-sm font-semibold" htmlFor="exp">Exp</label>
                  <input id="exp" name="exp" placeholder="MM/YY" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
                </div>
                <div>
                  <label className="mt-3 block text-sm font-semibold" htmlFor="cvc">CVC</label>
                  <input id="cvc" name="cvc" placeholder="123" className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" />
                </div>
              </div>
            </div>
          ) : null}
          <label className="mt-3 block text-sm font-semibold" htmlFor="note">Note for the farm</label>
          <textarea id="note" name="note" rows={3} className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3" placeholder="Pickup day or hatch questions" />
          {error ? <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">{error}</p> : null}
          {method === "ship" && totals.hasBirds ? <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">Live birds are pickup only.</p> : null}
          <button type="submit" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">Place order</button>
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
        </aside>
      </div>
    </Shell>
  );
}
