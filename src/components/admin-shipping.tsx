import { useEffect, useState } from "react";
import { money } from "@/lib/farm-store";
import { listShippingMethods, saveShippingMethod } from "@/lib/shop.functions";

const field = "mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2";

type Row = {
  slug: string;
  carrier: string;
  name: string;
  price: string;
  active: boolean;
  sortOrder: string;
  notes: string;
  listings: number;
  savedPrice: number | null;
};

type MethodWithCount = Awaited<ReturnType<typeof listShippingMethods>>[number];

function toRow(method: MethodWithCount): Row {
  return {
    slug: method.slug,
    carrier: method.carrier,
    name: method.name,
    price: method.price == null ? "" : String(method.price),
    active: method.active,
    sortOrder: String(method.sortOrder),
    notes: method.notes ?? "",
    listings: method.listings,
    savedPrice: method.price,
  };
}

const blankRow = (): Row => ({ slug: "", carrier: "USPS", name: "", price: "", active: true, sortOrder: "100", notes: "", listings: 0, savedPrice: null });

export function AdminShipping() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState<Row | null>(null);

  async function reload() {
    const next = await listShippingMethods();
    setRows(next.map(toRow));
    setReady(true);
  }

  useEffect(() => {
    void reload().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Shipping methods did not load."));
  }, []);

  async function save(row: Row) {
    setMessage("");
    try {
      await saveShippingMethod({
        data: {
          slug: row.slug || undefined,
          carrier: row.carrier,
          name: row.name,
          price: row.price.trim() === "" ? null : Number(row.price),
          active: row.active,
          sortOrder: Number(row.sortOrder),
          notes: row.notes,
        },
      });
      setAdding(null);
      await reload();
      setMessage(`${row.name} saved.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That shipping method did not save.");
    }
  }

  const update = (slug: string, patch: Partial<Row>) => setRows(rows.map((row) => (row.slug === slug ? { ...row, ...patch } : row)));
  const needsPrice = rows.filter((row) => row.active && row.savedPrice == null);

  function editor(row: Row, onChange: (patch: Partial<Row>) => void, onCancel?: () => void) {
    const id = row.slug || "new";
    return (
      <form
        key={id}
        className="rounded-card border border-line bg-paper p-4"
        data-testid={`method-${id}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save(row);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>{row.name || "New shipping method"}</strong>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {!row.active ? <span className="rounded-full bg-line px-2 py-0.5 text-xs">Off</span> : null}
            {row.active && row.savedPrice == null && row.slug ? <span className="rounded-full bg-note-bg px-2 py-0.5 text-xs font-semibold text-note">Needs price</span> : null}
            {row.savedPrice != null ? <span className="text-muted">Now {money(row.savedPrice)}</span> : null}
            {row.slug ? <span className="text-muted">· {row.listings} listing{row.listings === 1 ? "" : "s"}</span> : null}
          </span>
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-[6rem_1fr_8rem_6rem]">
          <div>
            <label className="text-xs font-semibold" htmlFor={`carrier-${id}`}>Carrier</label>
            <select id={`carrier-${id}`} value={row.carrier} onChange={(event) => onChange({ carrier: event.target.value })} className={field}>
              <option value="USPS">USPS</option>
              <option value="UPS">UPS</option>
              <option value="FedEx">FedEx</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold" htmlFor={`name-${id}`}>Name shoppers see</label>
            <input id={`name-${id}`} required value={row.name} onChange={(event) => onChange({ name: event.target.value })} className={field} />
          </div>
          <div>
            <label className="text-xs font-semibold" htmlFor={`price-${id}`}>Price (blank = not set)</label>
            <input id={`price-${id}`} inputMode="decimal" placeholder="Needs price" value={row.price} onChange={(event) => onChange({ price: event.target.value })} className={field} />
          </div>
          <div>
            <label className="text-xs font-semibold" htmlFor={`sort-${id}`}>Order</label>
            <input id={`sort-${id}`} inputMode="numeric" value={row.sortOrder} onChange={(event) => onChange({ sortOrder: event.target.value })} className={field} />
          </div>
        </div>
        <label className="mt-2 block text-xs font-semibold" htmlFor={`notes-${id}`}>Notes (farm only)</label>
        <input id={`notes-${id}`} value={row.notes} onChange={(event) => onChange({ notes: event.target.value })} className={field} />
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={row.active} onChange={(event) => onChange({ active: event.target.checked })} />
            Offered at checkout
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold">Save</button>
          {onCancel ? <button type="button" className="font-semibold" onClick={onCancel}>Cancel</button> : null}
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl">Shipping</h2>
        <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-barn px-5 font-semibold text-paper" onClick={() => setAdding(blankRow())}>
          Add method
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Farm pickup is always free and always offered. A shopper sees a shipping method only when every item in the cart allows it (set on each listing),
        it's offered at checkout, and it has a price.
      </p>
      {needsPrice.length ? (
        <p className="mt-3 rounded-xl bg-note-bg p-3 text-sm text-note">
          Needs price: {needsPrice.map((row) => row.name).join(", ")}. Shoppers won't see these until a price is saved.
        </p>
      ) : null}
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      {!ready ? <p className="mt-4 text-muted">Loading shipping methods…</p> : null}
      <div className="mt-4 space-y-3">
        {adding ? editor(adding, (patch) => setAdding({ ...adding, ...patch }), () => setAdding(null)) : null}
        {rows.map((row) => editor(row, (patch) => update(row.slug, patch)))}
      </div>
    </div>
  );
}
