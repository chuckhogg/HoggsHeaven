import { useEffect, useState } from "react";
import type { Product } from "@/lib/catalog";
import { deleteProduct, listShippingMethods, saveProduct } from "@/lib/shop.functions";
import { categoryLabel, DEFAULT_METHODS, isOffered, PRODUCT_CATEGORIES, type ProductCategory, type ShippingMethod } from "@/lib/shipping";
import { useCatalog } from "@/lib/use-catalog";
import { money } from "@/lib/farm-store";

const field = "mt-1 w-full rounded-xl border border-line bg-cream px-3 py-3";

type Draft = {
  id: number;
  name: string;
  category: ProductCategory;
  shipping: string[];
  image: string;
  description: string;
  variants: { sku: string; label: string; price: string; compare: string; stock: string }[];
};

const blank = (): Draft => ({
  id: 0,
  name: "",
  category: "eggs",
  shipping: [...DEFAULT_METHODS.eggs],
  image: "",
  description: "",
  variants: [{ sku: "", label: "", price: "", compare: "", stock: "" }],
});

function fromProduct(product: Product): Draft {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    shipping: [...product.shipping],
    image: product.image,
    description: product.description,
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      label: variant.label,
      price: String(variant.price),
      compare: variant.compare == null ? "" : String(variant.compare),
      stock: variant.stock == null ? "" : String(variant.stock),
    })),
  };
}

export function AdminProducts() {
  const { products, ready, error, reload } = useCatalog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [methods, setMethods] = useState<ShippingMethod[]>([]);

  useEffect(() => {
    void listShippingMethods()
      .then(setMethods)
      .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Shipping methods did not load."));
  }, []);

  const methodName = (slug: string) => methods.find((method) => method.slug === slug)?.name ?? slug;

  async function onSave() {
    if (!draft) return;
    setPending(true);
    setMessage("");
    try {
      await saveProduct({
        data: {
          id: draft.id || undefined,
          name: draft.name,
          category: draft.category,
          shipping: draft.shipping,
          image: draft.image,
          description: draft.description,
          variants: draft.variants.map((variant) => ({
            sku: variant.sku,
            label: variant.label,
            price: Number(variant.price),
            compare: variant.compare === "" ? null : Number(variant.compare),
            stock: variant.stock === "" ? null : Number(variant.stock),
          })),
        },
      });
      setDraft(null);
      await reload();
      setMessage("Listing saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That listing did not save.");
    } finally {
      setPending(false);
    }
  }

  async function onDelete(product: Product) {
    if (!confirm(`Delete ${product.name}?`)) return;
    setMessage("");
    try {
      await deleteProduct({ data: { id: product.id } });
      await reload();
      setMessage("Listing deleted.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not delete that listing.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl">Listings</h2>
        <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper" onClick={() => setDraft(blank())}>
          Add listing
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-barn">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-note">{message}</p> : null}
      {!ready ? <p className="mt-4 text-muted">Loading listings…</p> : null}
      <div className="mt-4 space-y-3">
        {products.map((product) => (
          <article key={product.id} className="grid gap-3 rounded-card border border-line bg-paper p-3 sm:grid-cols-[5rem_1fr_auto]">
            <img src={product.image} alt="" className="size-20 rounded-xl object-cover" />
            <div>
              <strong>{product.name}</strong>
              <p className="text-sm text-muted">{categoryLabel(product.category)} · {product.variants.map((variant) => `${variant.label} ${money(variant.price)}`).join(" · ")}</p>
              <p className="text-sm text-muted">Ships by: {product.shipping.length ? product.shipping.map(methodName).join(", ") : "pickup only"}</p>
            </div>
            <div className="flex gap-3 sm:flex-col sm:items-end">
              <button type="button" className="font-semibold text-barn" onClick={() => setDraft(fromProduct(product))}>Edit</button>
              <button type="button" className="font-semibold" onClick={() => onDelete(product)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      {draft ? (
        <form
          className="mt-4 rounded-card border border-line bg-paper p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave();
          }}
        >
          <h3 className="text-2xl">{draft.id ? "Edit listing" : "New listing"}</h3>
          <label className="mt-3 block text-sm font-semibold" htmlFor="pname">Name</label>
          <input id="pname" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={field} />
          <label className="mt-3 block text-sm font-semibold" htmlFor="category">Category</label>
          <select
            id="category"
            value={draft.category}
            onChange={(event) => {
              const category = event.target.value as ProductCategory;
              // A new listing picks up its category's usual methods; an existing one keeps its own.
              setDraft({ ...draft, category, shipping: draft.id ? draft.shipping : [...DEFAULT_METHODS[category]] });
            }}
            className={field}
          >
            {PRODUCT_CATEGORIES.map((category) => (
              <option key={category} value={category}>{categoryLabel(category)}</option>
            ))}
          </select>
          <fieldset className="mt-3" data-testid="listing-shipping">
            <legend className="text-sm font-semibold">Shipping methods</legend>
            <p className="text-sm text-muted">Farm pickup is always offered. Shoppers only see a checked method once it has a price.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {methods.map((method) => {
                const on = draft.shipping.includes(method.slug);
                return (
                  <label key={method.slug} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-cream px-3 py-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          shipping: on ? draft.shipping.filter((slug) => slug !== method.slug) : [...draft.shipping, method.slug],
                        })
                      }
                    />
                    <span className="flex-1">{method.name}</span>
                    {!method.active ? (
                      <span className="rounded-full bg-line px-2 py-0.5 text-xs">Off</span>
                    ) : isOffered(method) ? (
                      <span className="text-sm text-muted">{money(method.price ?? 0)}</span>
                    ) : (
                      <span className="rounded-full bg-note-bg px-2 py-0.5 text-xs text-note">Needs price</span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="mt-3 block text-sm font-semibold" htmlFor="image">Image address</label>
          <input id="image" required value={draft.image} onChange={(event) => setDraft({ ...draft, image: event.target.value })} className={field} placeholder="https://" />
          <label className="mt-3 block text-sm font-semibold" htmlFor="description">Description</label>
          <textarea id="description" rows={5} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={field} />
          <p className="mt-4 text-sm font-semibold">Options</p>
          {draft.variants.map((variant, index) => (
            <div key={index} className="mt-2 grid gap-2 sm:grid-cols-5">
              <input aria-label="Option label" placeholder="Label" value={variant.label} onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} className={field} />
              <input aria-label="SKU" placeholder="SKU" value={variant.sku} onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, i) => i === index ? { ...item, sku: event.target.value } : item) })} className={field} />
              <input aria-label="Price" placeholder="Price" inputMode="decimal" value={variant.price} onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, i) => i === index ? { ...item, price: event.target.value } : item) })} className={field} />
              <input aria-label="Compare price" placeholder="Compare" inputMode="decimal" value={variant.compare} onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, i) => i === index ? { ...item, compare: event.target.value } : item) })} className={field} />
              <input aria-label="Stock" placeholder="Stock blank = open" inputMode="numeric" value={variant.stock} onChange={(event) => setDraft({ ...draft, variants: draft.variants.map((item, i) => i === index ? { ...item, stock: event.target.value } : item) })} className={field} />
            </div>
          ))}
          <button type="button" className="mt-3 text-sm font-semibold text-barn" onClick={() => setDraft({ ...draft, variants: [...draft.variants, { sku: "", label: "", price: "", compare: "", stock: "" }] })}>
            Add option
          </button>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper disabled:opacity-60">Save listing</button>
            <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
