import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { cartTotals, hydrateFarm, money, removeLine, setQty, useFarm } from "@/lib/farm-store";

export const Route = createFileRoute("/cart")({ component: CartPage });

function CartPage() {
  const farm = useFarm();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydrateFarm();
    setReady(true);
  }, []);
  const totals = cartTotals(farm.cart, 0, farm.settings);
  return (
    <Shell>
      <h1 className="text-4xl">Cart</h1>
      {!ready ? <p className="mt-4 text-muted">Loading cart…</p> : null}
      {ready && farm.cart.length === 0 ? (
        <div className="mt-6">
          <p>Your cart is empty.</p>
          <Link to="/shop" search={{ f: "all" }} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">Browse the flock</Link>
        </div>
      ) : null}
      {farm.cart.map((line) => (
        <div key={line.key} className="grid grid-cols-[4.5rem_1fr_auto] gap-3 border-b border-line py-4">
          <img src={line.image} alt="" className="size-16 rounded-xl object-cover" />
          <div>
            <strong>{line.name}</strong>
            <p className="text-sm text-muted">{line.label}</p>
            <p>{money(line.price)}</p>
          </div>
          <div className="text-right">
            <input
              className="w-16 rounded-lg border border-line bg-paper px-2 py-2"
              type="number"
              min={1}
              value={line.qty}
              aria-label={`Quantity for ${line.name}`}
              onChange={(event) => setQty(line.key, Number(event.target.value) || 1)}
            />
            <button type="button" className="mt-2 block text-sm text-barn" onClick={() => removeLine(line.key)}>
              Remove
            </button>
          </div>
        </div>
      ))}
      {farm.cart.length > 0 ? (
        <div className="mt-4 flex items-center justify-between">
          <span>Subtotal</span>
          <strong>{money(totals.sub)}</strong>
        </div>
      ) : null}
      {farm.cart.length > 0 ? (
        <Link to="/checkout" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">
          Checkout
        </Link>
      ) : null}
    </Shell>
  );
}
