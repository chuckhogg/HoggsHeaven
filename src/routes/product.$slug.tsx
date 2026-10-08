import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { addToCart, money } from "@/lib/farm-store";
import { useCatalog } from "@/lib/use-catalog";
import { Shell } from "@/components/shell";
import { categoryLabel, isOffered } from "@/lib/shipping";

export const Route = createFileRoute("/product/$slug")({ component: ProductPage });

function ProductPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { products, shipping, ready } = useCatalog();
  const product = products.find((item) => item.slug === slug);
  const first = product?.variants.find((variant) => variant.stock !== 0) ?? product?.variants[0];
  const [variantId, setVariantId] = useState(0);
  const [qty, setQty] = useState(1);
  useEffect(() => {
    if (first && variantId === 0) setVariantId(first.id);
  }, [first, variantId]);
  if (!ready) {
    return <Shell><p className="text-muted">Loading the listing…</p></Shell>;
  }
  if (!product || !first) {
    return (
      <Shell>
        <h1 className="text-4xl">Listing not found</h1>
        <Link to="/shop" search={{ f: "all" }} className="mt-4 inline-flex min-h-11 items-center font-semibold text-barn">Back to the shop</Link>
      </Shell>
    );
  }
  const variant = product.variants.find((item) => item.id === variantId) ?? first;
  const sold = variant.stock === 0;
  const shipsBy = shipping.filter((method) => product.shipping.includes(method.slug) && isOffered(method));
  return (
    <Shell>
      <div className="grid gap-8 md:grid-cols-2">
        <img src={product.image} alt={product.name} className="w-full rounded-card object-cover md:h-[32rem]" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">
            {categoryLabel(product.category)}
          </p>
          <h1 className="mt-2 text-4xl">{product.name}</h1>
          <p className="mt-3 text-2xl font-semibold">
            {variant.compare ? <s className="mr-2 text-lg font-normal text-muted">{money(variant.compare)}</s> : null}
            {money(variant.price)}
          </p>
          <div className="mt-4 space-y-2">
            {product.variants.map((option) => {
              const out = option.stock === 0;
              const on = option.id === variant.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={out}
                  onClick={() => setVariantId(option.id)}
                  className={
                    on
                      ? "flex w-full items-center justify-between rounded-xl border border-barn bg-paper px-3 py-3 text-left"
                      : "flex w-full items-center justify-between rounded-xl border border-line bg-paper px-3 py-3 text-left"
                  }
                >
                  <span>
                    {option.label}
                    {out ? " · sold out" : option.stock ? ` · ${option.stock} on hand` : ""}
                  </span>
                  <strong>{money(option.price)}</strong>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" className="size-11 rounded-full border border-line bg-paper" onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="Decrease quantity">−</button>
            <strong>{qty}</strong>
            <button type="button" className="size-11 rounded-full border border-line bg-paper" onClick={() => setQty((n) => n + 1)} aria-label="Increase quantity">+</button>
          </div>
          <button
            type="button"
            disabled={sold}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper disabled:opacity-50"
            onClick={() => {
              addToCart({
                slug: product.slug,
                variantId: variant.id,
                name: product.name,
                label: variant.label,
                price: variant.price,
                image: product.image,
                qty,
                sku: variant.sku,
                kind: product.kind,
              });
              navigate({ to: "/cart" });
            }}
          >
            {sold ? "Sold out" : "Add to cart"}
          </button>
          <div className="mt-6 rounded-xl border border-line bg-paper p-3 text-sm" data-testid="ships-by">
            <p className="font-semibold">Pickup and shipping</p>
            <ul className="mt-1 space-y-1">
              <li className="flex justify-between gap-3"><span>Farm pickup in Shelbyville</span><span>Free</span></li>
              {shipsBy.map((method) => (
                <li key={method.slug} className="flex justify-between gap-3"><span>{method.name}</span><span>{money(method.price ?? 0)}</span></li>
              ))}
            </ul>
            {shipsBy.length === 0 ? <p className="mt-1 text-muted">Shipping isn't available for this listing yet. Call 502-435-6649 to ask.</p> : null}
          </div>
          <p className="mt-6 whitespace-pre-wrap text-muted">{product.description}</p>
        </div>
      </div>
    </Shell>
  );
}
