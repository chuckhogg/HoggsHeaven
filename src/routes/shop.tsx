import { createFileRoute, Link } from "@tanstack/react-router";
import { products } from "@/lib/catalog";
import { ProductCard } from "@/components/product-card";
import { Shell } from "@/components/shell";

type Filter = "all" | "eggs" | "birds" | "sale";

export const Route = createFileRoute("/shop")({
  validateSearch: (search: Record<string, unknown>): { f: Filter } => {
    const value = search.f;
    if (value === "eggs" || value === "birds" || value === "sale") return { f: value };
    return { f: "all" };
  },
  component: ShopPage,
});

function ShopPage() {
  const { f } = Route.useSearch();
  const items = products.filter((product) => {
    if (f === "eggs" || f === "birds") return product.kind === f;
    if (f === "sale") return product.variants.some((variant) => variant.compare);
    return true;
  });
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "eggs", label: "Hatching eggs" },
    { id: "birds", label: "Birds" },
    { id: "sale", label: "On sale" },
  ];
  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">Store</p>
          <h1 className="text-4xl">Hatching eggs and chicks</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <Link
              key={filter.id}
              to="/shop"
              search={{ f: filter.id }}
              className={
                f === filter.id
                  ? "inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-paper"
                  : "inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4"
              }
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((product) => (
          <ProductCard key={product.slug} product={product} />
        ))}
      </div>
    </Shell>
  );
}
