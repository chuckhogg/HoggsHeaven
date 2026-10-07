import { createFileRoute, Link } from "@tanstack/react-router";
import { reviews } from "@/lib/catalog";
import { ProductCard } from "@/components/product-card";
import { Shell } from "@/components/shell";
import { useCatalog } from "@/lib/use-catalog";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { products, ready } = useCatalog();
  const featured = products.filter((product) => /ayam|bresse|maran|death|pita/i.test(product.name)).slice(0, 6);
  const shown = featured.length > 0 ? featured : products.slice(0, 6);
  const hero = [
    products.find((product) => product.slug === "ayam-cemani"),
    products.find((product) => product.slug === "white-bresse-hatching-eggs"),
    products.find((product) => product.slug === "black-copper-maran-blc-cpp-mrn"),
  ].map((product, index) => product ?? products[index]);
  return (
    <Shell>
      <section className="grid items-center gap-8 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">Shelby County hatchery</p>
          <h1 className="mt-2 text-5xl md:text-6xl">Rare birds. Real farm.</h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Hatching eggs and chicks from Hogg's Heaven. Ayam Cemani, Bresse, Black Copper Marans, Wheaten Marans, Gold Deathlayers, and Pita Pintas.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/shop" search={{ f: "all" }} className="inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper">
              Shop the flock
            </Link>
            <Link to="/track" className="inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold">
              Track an order
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {ready && hero[0] && hero[1] && hero[2] ? (
            <>
              <img src={hero[0].image} alt={hero[0].name} className="col-span-1 row-span-2 h-full min-h-72 w-full rounded-card object-cover" />
              <img src={hero[1].image} alt={hero[1].name} className="h-40 w-full rounded-card object-cover md:h-52" />
              <img src={hero[2].image} alt={hero[2].name} className="h-40 w-full rounded-card object-cover md:h-52" />
            </>
          ) : (
            <div className="col-span-2 min-h-72 rounded-card bg-paper" />
          )}
        </div>
      </section>
      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["23", "listings from the farm store"],
          ["100%", "of published reviews recommend"],
          ["5 acres", "Shelby County, Kentucky"],
          ["Pickup", "or shipped hatching eggs"],
        ].map(([title, detail]) => (
          <div key={title} className="rounded-card border border-line bg-paper p-4">
            <b className="block font-display text-3xl">{title}</b>
            <span className="text-sm text-muted">{detail}</span>
          </div>
        ))}
      </section>
      <section className="mt-12">
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="text-4xl">Our breeds</h2>
          <Link to="/shop" search={{ f: "all" }} className="font-semibold text-barn">View all</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      </section>
      <section className="mt-12">
        <h2 className="mb-4 text-4xl">Reviews</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {reviews.slice(0, 3).map((review) => (
            <article key={review.name} className="rounded-card border border-line bg-paper p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-barn">Recommends</p>
              <p className="mt-2">&ldquo;{review.text}&rdquo;</p>
              <p className="mt-3 font-semibold">{review.name}</p>
              <p className="text-sm text-muted">{review.date}</p>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}
