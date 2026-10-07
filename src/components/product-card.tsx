import { Link } from "@tanstack/react-router";
import type { Product } from "@/lib/catalog";
import { money } from "@/lib/farm-store";

export function fromPrice(product: Product) {
  return product.variants.reduce((min, variant) => (variant.price < min.price ? variant : min), product.variants[0]);
}

export function ProductCard({ product }: { product: Product }) {
  const variant = fromPrice(product);
  const sold = product.variants.every((item) => item.stock === 0);
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-paper shadow-sm">
      <Link to="/product/$slug" params={{ slug: product.slug }}>
        <img src={product.image} alt="" className="h-56 w-full bg-line object-cover" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-barn">
          {sold ? "Sold out" : product.kind === "eggs" ? "Hatching eggs" : "Birds"}
        </p>
        <h3 className="text-xl">{product.name}</h3>
        <p className="font-semibold">
          {variant.compare ? <s className="mr-2 font-normal text-muted">{money(variant.compare)}</s> : null}
          {money(variant.price)}
        </p>
        <Link
          to="/product/$slug"
          params={{ slug: product.slug }}
          className="mt-auto inline-flex min-h-11 items-center justify-center rounded-full bg-barn px-4 font-semibold text-paper"
        >
          Choose options
        </Link>
      </div>
    </article>
  );
}
