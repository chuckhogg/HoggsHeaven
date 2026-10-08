import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Mail, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Order, OrderStatus } from "@/lib/farm-store";
import { money, ORDER_STATUSES, statusLabel } from "@/lib/farm-store";
import {
  blankDraft,
  blankLine,
  buildPatch,
  draftFromOrder,
  linesForSave,
  SECTION_LABEL,
  type LineDraft,
  type OrderDraft,
  type Section,
} from "@/lib/order-draft";
import { parseOrderNote, trackingUrl } from "@/lib/order-note";
import { planOrderEdit, type ShippingMethod } from "@/lib/shipping";
import { createOrder, deleteOrder, getAdminOrder, listShippingMethods, updateOrder } from "@/lib/shop.functions";
import { useCatalog } from "@/lib/use-catalog";
import { ConfirmDialog } from "./confirm-dialog";
import { invalidateOrderList, when } from "@/lib/order-list-cache";
import { StatusPill } from "./order-bits";

const input = "mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2.5 focus:border-ink focus:outline-none";
const card = "rounded-card border border-line bg-paper p-4 sm:p-5";
type EditableSection = Exclude<Section, "status">;

export function AdminOrderView({ id }: { id: string }) {
  const isNew = id === "new";
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(isNew ? "ready" : "loading");
  const [loadError, setLoadError] = useState("");
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const base = useMemo(() => (order ? draftFromOrder(order) : blankDraft()), [order]);
  const [draft, setDraft] = useState<OrderDraft>(blankDraft());
  const [editing, setEditing] = useState<Set<EditableSection>>(
    () => new Set(isNew ? (["customer", "fulfillment", "items", "notes"] as EditableSection[]) : []),
  );
  const [focus, setFocus] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [confirmPaid, setConfirmPaid] = useState<OrderStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    let live = true;
    listShippingMethods().then((next) => live && setMethods(next)).catch(() => undefined);
    if (!isNew) {
      getAdminOrder({ data: { id } })
        .then((found) => {
          if (!live) return;
          if (!found) setState("missing");
          else {
            setOrder(found);
            setDraft(draftFromOrder(found));
            setState("ready");
          }
        })
        .catch((err: unknown) => {
          if (!live) return;
          setLoadError(err instanceof Error ? err.message : "The order did not load.");
          setState("error");
        });
    }
    return () => {
      live = false;
    };
  }, [id, isNew]);

  const { patch, sections } = useMemo(() => buildPatch(base, draft), [base, draft]);
  const dirty = isNew ? JSON.stringify(draft) !== JSON.stringify(blankDraft()) : sections.length > 0;

  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  });

  const set = (next: Partial<OrderDraft>) => setDraft((current) => ({ ...current, ...next }));
  const setLine = (index: number, next: Partial<LineDraft>) =>
    setDraft((current) => ({ ...current, items: current.items.map((line, i) => (i === index ? { ...line, ...next } : line)) }));

  function startEdit(section: EditableSection, field = "") {
    setEditing((current) => new Set(current).add(section));
    setFocus(field);
    setFlash("");
  }

  function cancelAll() {
    setDraft(base);
    setEditing(new Set());
    setError("");
  }

  function onStatus(next: OrderStatus) {
    if (next === "paid" && base.status !== "paid") setConfirmPaid(next);
    else set({ status: next, statusNote: next === base.status ? "" : draft.statusNote });
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      if (isNew) {
        const created = await createOrder({
          data: {
            name: draft.name,
            email: draft.email,
            phone: draft.phone,
            shipping: draft.shipping,
            address: draft.address,
            status: draft.status,
            note: draft.note,
            items: linesForSave(draft.items),
          },
        });
        invalidateOrderList(created);
        leaving.current = true;
        await navigate({ to: "/admin/orders/$id", params: { id: created.id }, replace: true });
        return;
      }
      if (!order) return;
      const result = await updateOrder({ data: { id: order.id, patch } });
      invalidateOrderList(result.order);
      setOrder(result.order);
      setDraft(draftFromOrder(result.order));
      setEditing(new Set());
      setFlash(result.changed.length ? "Saved." : "Nothing changed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!order) return;
    setConfirmDelete(false);
    try {
      await deleteOrder({ data: { id: order.id } });
      invalidateOrderList(undefined, order.id);
      leaving.current = true;
      await navigate({ to: "/admin" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The order was not deleted.");
    }
  }

  // Totals after save, when lines or the method changed (stored totals otherwise stay).
  const preview = useMemo(() => {
    if (isNew || !order || !(patch.items || patch.shipping)) return null;
    const chosen = methods.find((method) => method.slug === draft.shipping);
    try {
      const plan = planOrderEdit(
        {
          method: order.method,
          shippingMethod: order.shippingMethod?.slug ?? null,
          address: order.address,
          subtotal: order.totals.sub,
          shipping: order.totals.ship,
          tax: order.totals.tax,
          total: order.totals.total,
          items: linesForSave(base.items).map((line) => ({ ...line, label: line.label || line.name })),
        },
        {
          method: draft.shipping === "pickup" ? "pickup" : "ship",
          shippingMethod: draft.shipping === "pickup" || draft.shipping === "legacy-ship" ? null : draft.shipping,
          address: draft.address,
          items: linesForSave(draft.items).map((line) => ({ ...line, price: Number(line.price) || 0, qty: Number(line.qty) || 0, label: line.label || line.name })),
        },
        { taxRate: catalog.settings.taxRate, newShipping: chosen ? chosen.price : draft.shipping === "pickup" ? 0 : null },
      );
      return { plan, problem: "" };
    } catch (err) {
      return { plan: null, problem: err instanceof Error ? err.message : "Can't price that." };
    }
  }, [isNew, order, patch.items, patch.shipping, methods, draft, base, catalog.settings.taxRate]);

  if (state === "loading") return <p className="text-muted">Opening order {id}…</p>;
  if (state === "missing" || state === "error") {
    return (
      <div>
        <BackLink />
        <h1 className="mt-4 text-3xl">{state === "missing" ? "Order not found" : "The order didn't load"}</h1>
        <p className="mt-2 text-muted">{state === "missing" ? `There's no order ${id} on this desk.` : loadError}</p>
      </div>
    );
  }

  const note = parseOrderNote(order?.note ?? "");
  const history = [...(order?.history ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const lastUpdate = history.length ? history[history.length - 1]?.at : order?.created;
  const isEditing = (section: EditableSection) => editing.has(section);
  const methodOptions = methods.filter(
    (method) => method.slug === draft.shipping || method.slug === base.shipping || (method.active && method.price != null),
  );
  const showBar = isNew || dirty || editing.size > 0 || Boolean(error);

  return (
    <div className={showBar ? "pb-28" : ""}>
      <BackLink />

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">{isNew ? "New order" : "Order"}</p>
          <h1 className="font-mono text-3xl sm:text-4xl">{isNew ? "Add an order" : order?.id}</h1>
          {order ? (
            <p className="mt-1 text-sm text-muted">
              Placed {when(order.created)}
              {lastUpdate && lastUpdate !== order.created ? ` · Last update ${when(lastUpdate)}` : ""}
            </p>
          ) : null}
        </div>
        <div className="w-full rounded-card border border-line bg-paper p-3 sm:w-72">
          <label htmlFor="order-status" className="flex items-center justify-between text-sm font-semibold">
            Status {order ? <StatusPill status={base.status} /> : null}
          </label>
          <select
            id="order-status"
            value={draft.status}
            onChange={(event) => onStatus(event.target.value as OrderStatus)}
            className={`${input} ${draft.status !== base.status ? "border-gold bg-note-bg" : ""}`}
          >
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>{statusLabel(status)}</option>
            ))}
          </select>
          {!isNew && draft.status !== base.status ? (
            <input
              aria-label="Note for the history entry"
              placeholder="Note for history (optional)"
              value={draft.statusNote}
              onChange={(event) => set({ statusNote: event.target.value })}
              className={`${input} text-sm`}
            />
          ) : null}
        </div>
      </header>

      {flash && !dirty ? <p role="status" className="mt-3 rounded-xl bg-moss/10 px-3 py-2 text-sm text-moss">{flash}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:order-2">
          <SectionCard title="Customer" editing={isEditing("customer")} onEdit={() => startEdit("customer", "name")} changed={sections.includes("customer")}>
            {isEditing("customer") ? (
              <div className="space-y-2">
                <Field label="Name" id="c-name">
                  <input id="c-name" autoFocus={focus === "name"} value={draft.name} onChange={(e) => set({ name: e.target.value })} className={input} />
                </Field>
                <Field label="Email" id="c-email">
                  <input id="c-email" type="email" autoFocus={focus === "email"} value={draft.email} onChange={(e) => set({ email: e.target.value })} className={input} />
                </Field>
                <Field label="Phone" id="c-phone">
                  <input id="c-phone" type="tel" autoFocus={focus === "phone"} value={draft.phone} onChange={(e) => set({ phone: e.target.value })} className={input} />
                </Field>
              </div>
            ) : (
              <dl className="space-y-2">
                <ClickValue label="Name" onClick={() => startEdit("customer", "name")}>{draft.name}</ClickValue>
                <ClickValue
                  label="Email"
                  onClick={() => startEdit("customer", "email")}
                  extra={draft.email ? <a href={`mailto:${draft.email}`} className="text-muted hover:text-barn" aria-label="Email customer"><Mail className="size-4" /></a> : null}
                >
                  {draft.email}
                </ClickValue>
                <ClickValue
                  label="Phone"
                  onClick={() => startEdit("customer", "phone")}
                  extra={draft.phone ? <a href={`tel:${draft.phone}`} className="text-muted hover:text-barn" aria-label="Call customer"><Phone className="size-4" /></a> : null}
                >
                  {draft.phone}
                </ClickValue>
              </dl>
            )}
          </SectionCard>

          <SectionCard title="Fulfillment" editing={isEditing("fulfillment")} onEdit={() => startEdit("fulfillment", "method")} changed={sections.includes("fulfillment")}>
            {isEditing("fulfillment") ? (
              <div className="space-y-2">
                <Field label="Method" id="f-method">
                  <select id="f-method" autoFocus={focus === "method"} value={draft.shipping} onChange={(e) => set({ shipping: e.target.value })} className={input}>
                    <option value="pickup">Farm pickup (free)</option>
                    {base.shipping === "legacy-ship" ? <option value="legacy-ship">Shipped (method not recorded)</option> : null}
                    {methodOptions.map((method) => (
                      <option key={method.slug} value={method.slug}>
                        {method.name} · {method.price == null ? "needs price" : money(method.price)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Address" id="f-address">
                  <textarea id="f-address" rows={3} autoFocus={focus === "address"} value={draft.address} onChange={(e) => set({ address: e.target.value })} className={input} />
                </Field>
                {!isNew ? <p className="text-xs text-muted">Leaving the address blank keeps the stored one. Changing the method reprices shipping.</p> : null}
              </div>
            ) : (
              <dl className="space-y-2">
                <ClickValue label="Method" onClick={() => startEdit("fulfillment", "method")}>{methodName(draft.shipping, methods, order)}</ClickValue>
                <ClickValue label="Address" onClick={() => startEdit("fulfillment", "address")}>
                  <span className="whitespace-pre-line">{draft.address}</span>
                </ClickValue>
              </dl>
            )}
          </SectionCard>

          {order ? <div className="hidden lg:block"><DangerZone onDelete={() => setConfirmDelete(true)} /></div> : null}
        </div>

        <div className="space-y-4 lg:order-1 lg:col-span-2">
          <SectionCard title="Items" editing={isEditing("items")} onEdit={() => startEdit("items")} changed={sections.includes("items")}>
            {isEditing("items") ? (
              <ItemsEditor draft={draft} setLine={setLine} set={set} catalog={catalog.products} />
            ) : (
              <ItemsTable items={draft.items} onEdit={() => startEdit("items")} />
            )}
            {order ? (
              <Totals
                order={order}
                discount={note.discount}
                shippingLabel={base.shipping === "legacy-ship" ? "method not recorded" : methodName(base.shipping, methods, order)}
                preview={preview}
              />
            ) : (
              <p className="mt-3 text-sm text-muted">Totals are calculated at today's shipping price and tax rate when you save.</p>
            )}
          </SectionCard>

          <SectionCard title="Notes" editing={isEditing("notes")} onEdit={() => startEdit("notes", "note")} changed={sections.includes("notes")}>
            {isEditing("notes") ? (
              <Field label="Notes (shown here only, not to the customer)" id="n-note">
                <textarea id="n-note" rows={8} autoFocus={focus === "note"} value={draft.note} onChange={(e) => set({ note: e.target.value })} className={`${input} font-mono text-sm`} />
              </Field>
            ) : (
              <NoteView parsed={note} raw={order?.note ?? ""} onEdit={() => startEdit("notes", "note")} />
            )}
          </SectionCard>

          {order ? (
            <section className={card}>
              <h2 className="text-xl">History</h2>
              <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
                {history.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="relative">
                    <span className="absolute -left-[1.4rem] top-1.5 size-3 rounded-full border-2 border-paper bg-ink" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={entry.status} />
                      <span className="text-sm text-muted">{when(entry.at)}</span>
                    </div>
                    {entry.note ? <p className="mt-0.5 text-sm">{entry.note}</p> : null}
                  </li>
                ))}
                {draft.status !== base.status ? (
                  <li className="relative opacity-80">
                    <span className="absolute -left-[1.4rem] top-1.5 size-3 rounded-full border-2 border-paper bg-gold" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={draft.status} />
                      <span className="text-sm italic text-muted">added when you save</span>
                    </div>
                    <p className="mt-0.5 text-sm">{draft.statusNote.trim() || "Status changed on the farm desk."}</p>
                  </li>
                ) : null}
              </ol>
            </section>
          ) : null}
        </div>
      </div>

      {order ? <div className="mt-4 lg:hidden"><DangerZone onDelete={() => setConfirmDelete(true)} /></div> : null}

      {showBar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 shadow-[0_-4px_16px_rgba(26,18,14,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
            <p className="mr-auto text-sm" role="status">
              {error ? (
                <span className="font-semibold text-barn">{error}</span>
              ) : isNew ? (
                "New order: fill in the customer and at least one line."
              ) : dirty ? (
                <>Unsaved changes: <strong>{sections.map((s) => SECTION_LABEL[s]).join(", ")}</strong></>
              ) : (
                "No changes yet."
              )}
            </p>
            <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold" onClick={() => (isNew ? void navigate({ to: "/admin" }) : cancelAll())} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-barn px-6 font-semibold text-paper disabled:opacity-50"
              onClick={() => void save()}
              disabled={saving || (!dirty && !isNew)}
            >
              {saving ? "Saving…" : isNew ? "Create order" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmPaid !== null}
        title="Mark this order paid?"
        confirmLabel="Yes, the payment cleared"
        onConfirm={() => {
          if (confirmPaid) set({ status: confirmPaid });
          setConfirmPaid(null);
        }}
        onCancel={() => setConfirmPaid(null)}
      >
        Only mark an order paid after the payment has cleared on Stripe or Square. Card details are never entered or stored here.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title={`Delete ${order?.id ?? "this order"}?`}
        confirmLabel="Delete order"
        cancelLabel="Keep it"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      >
        This permanently removes the order, its line items and its history. It can't be undone. To keep a record, set the status to Cancelled instead.
      </ConfirmDialog>

      <ConfirmDialog
        open={blocker.status === "blocked"}
        title="Leave without saving?"
        confirmLabel="Discard changes"
        cancelLabel="Stay here"
        danger
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      >
        You have unsaved changes to this order{sections.length ? ` (${sections.map((s) => SECTION_LABEL[s]).join(", ")})` : ""}.
      </ConfirmDialog>
    </div>
  );
}

function DangerZone({ onDelete }: { onDelete: () => void }) {
  return (
    <section className="rounded-card border border-barn/30 bg-paper p-4 sm:p-5">
      <h2 className="text-lg text-barn">Delete order</h2>
      <p className="mt-1 text-sm text-muted">Removes the order and its history for good. Prefer “Cancelled” to keep a record.</p>
      <button
        type="button"
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-barn px-4 font-semibold text-barn hover:bg-barn hover:text-paper"
        onClick={onDelete}
      >
        <Trash2 className="size-4" aria-hidden /> Delete order…
      </button>
    </section>
  );
}

function BackLink() {
  return (
    <Link to="/admin" className="inline-flex min-h-11 items-center gap-2 font-semibold text-barn">
      <ArrowLeft className="size-4" aria-hidden /> All orders
    </Link>
  );
}

function methodName(choice: string, methods: ShippingMethod[], order: Order | null) {
  if (choice === "pickup") return "Farm pickup";
  if (choice === "legacy-ship") return "Shipped (method not recorded)";
  return methods.find((method) => method.slug === choice)?.name ?? (order?.shippingMethod?.slug === choice ? order.shippingMethod.name : choice);
}

function SectionCard({ title, editing, onEdit, changed, children }: { title: string; editing: boolean; onEdit: () => void; changed: boolean; children: ReactNode }) {
  return (
    <section className={`${card} ${changed ? "border-gold" : ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xl">
          {title}
          {changed ? <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-wide text-note">edited</span> : null}
        </h2>
        {!editing ? (
          <button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold text-barn hover:bg-cream" aria-label={`Edit ${title.toLowerCase()}`}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {children}
    </div>
  );
}

function ClickValue({ label, onClick, extra, children }: { label: string; onClick: () => void; extra?: ReactNode; children: ReactNode }) {
  const empty = children === "" || children == null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="flex items-start gap-2">
        <button
          type="button"
          onClick={onClick}
          title={`Click to edit ${label.toLowerCase()}`}
          className="-mx-1 min-w-0 flex-1 break-words rounded-md px-1 text-left hover:bg-cream hover:underline hover:decoration-dotted"
        >
          {empty ? <span className="italic text-muted">Not set</span> : children}
        </button>
        {extra}
      </dd>
    </div>
  );
}

function ItemsTable({ items, onEdit }: { items: LineDraft[]; onEdit: () => void }) {
  return (
    <>
    <ul className="divide-y divide-line/70 sm:hidden">
      {items.map((item, index) => (
        <li key={index}>
          <button type="button" onClick={onEdit} className="flex w-full items-start justify-between gap-3 py-2 text-left text-sm">
            <span className="min-w-0">
              <span className="block font-semibold">{item.name}</span>
              <span className="block text-muted">
                {[item.label && item.label !== item.name ? item.label : "", item.sku, `${item.qty} × ${money(Number(item.price))}`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="font-semibold">{money(Number(item.price) * Number(item.qty))}</span>
          </button>
        </li>
      ))}
    </ul>
    <div className="-mx-1 hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-1 py-2 font-semibold">Item</th>
            <th className="px-1 py-2 font-semibold">SKU</th>
            <th className="px-1 py-2 text-right font-semibold">Qty</th>
            <th className="px-1 py-2 text-right font-semibold">Price</th>
            <th className="px-1 py-2 text-right font-semibold">Line total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index} className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-cream" onClick={onEdit}>
              <td className="px-1 py-2">
                <p className="font-semibold">{item.name}</p>
                {item.label && item.label !== item.name ? <p className="text-muted">{item.label}</p> : null}
              </td>
              <td className="px-1 py-2 font-mono text-xs text-muted">{item.sku || "—"}</td>
              <td className="px-1 py-2 text-right">{item.qty}</td>
              <td className="px-1 py-2 text-right">{money(Number(item.price))}</td>
              <td className="px-1 py-2 text-right font-semibold">{money(Number(item.price) * Number(item.qty))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

type CatalogProduct = ReturnType<typeof useCatalog>["products"][number];

function ItemsEditor({
  draft,
  setLine,
  set,
  catalog,
}: {
  draft: OrderDraft;
  setLine: (index: number, next: Partial<LineDraft>) => void;
  set: (next: Partial<OrderDraft>) => void;
  catalog: CatalogProduct[];
}) {
  const [pick, setPick] = useState("");
  function addFromCatalog(value: string) {
    if (!value) return;
    if (value === "custom") set({ items: [...draft.items, blankLine()] });
    else {
      const [productId, variantId] = value.split(":").map(Number);
      const product = catalog.find((entry) => entry.id === productId);
      const variant = product?.variants.find((entry) => entry.id === variantId);
      if (product && variant) {
        set({
          items: [
            ...draft.items,
            { name: product.name, label: variant.label, price: String(variant.price), qty: "1", sku: variant.sku, image: product.image, kind: product.kind, slug: product.slug, variantId: variant.id },
          ],
        });
      }
    }
    setPick("");
  }
  return (
    <div className="space-y-3">
      {draft.items.map((item, index) => (
        <div key={index} className="rounded-xl border border-line bg-cream/50 p-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_1.4fr_1fr]">
            <label className="text-xs font-semibold">Item
              <input aria-label={`Line ${index + 1} name`} value={item.name} onChange={(e) => setLine(index, { name: e.target.value })} className={input} placeholder="Bird or eggs" />
            </label>
            <label className="text-xs font-semibold">Option
              <input aria-label={`Line ${index + 1} option`} value={item.label} onChange={(e) => setLine(index, { label: e.target.value })} className={input} placeholder="e.g. 1 Dozen" />
            </label>
            <label className="text-xs font-semibold">SKU
              <input aria-label={`Line ${index + 1} SKU`} value={item.sku} onChange={(e) => setLine(index, { sku: e.target.value })} className={input} />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[8rem_8rem_8rem_1fr_auto]">
            <label className="text-xs font-semibold">Qty
              <input aria-label={`Line ${index + 1} quantity`} inputMode="numeric" value={item.qty} onChange={(e) => setLine(index, { qty: e.target.value })} className={input} />
            </label>
            <label className="text-xs font-semibold">Price
              <input aria-label={`Line ${index + 1} price`} inputMode="decimal" value={item.price} onChange={(e) => setLine(index, { price: e.target.value })} className={input} />
            </label>
            <label className="hidden text-xs font-semibold sm:block">Kind
              <select aria-label={`Line ${index + 1} kind`} value={item.kind} onChange={(e) => setLine(index, { kind: e.target.value as LineDraft["kind"] })} className={input}>
                <option value="eggs">Eggs</option>
                <option value="birds">Birds</option>
              </select>
            </label>
            <p className="hidden pb-3 text-right font-semibold sm:block">{money((Number(item.price) || 0) * (Number(item.qty) || 0))}</p>
            <button
              type="button"
              className="mb-1 inline-flex size-10 items-center justify-center rounded-full border border-line text-muted hover:border-barn hover:text-barn disabled:opacity-40"
              aria-label={`Remove line ${index + 1}`}
              disabled={draft.items.length === 1}
              onClick={() => set({ items: draft.items.filter((_, i) => i !== index) })}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ))}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <Plus className="size-4 text-barn" aria-hidden />
        <span className="sr-only">Add a line</span>
        <select value={pick} onChange={(e) => addFromCatalog(e.target.value)} className="w-full rounded-xl border border-dashed border-ink/40 bg-paper px-3 py-2.5 sm:w-96">
          <option value="">Add a line…</option>
          <option value="custom">Custom line (type it in)</option>
          {catalog.map((product) => (
            <optgroup key={product.id} label={product.name}>
              {product.variants.map((variant) => (
                <option key={variant.id} value={`${product.id}:${variant.id}`}>
                  {product.name} · {variant.label} · {money(variant.price)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}

function Totals({
  order,
  discount,
  shippingLabel,
  preview,
}: {
  order: Order;
  discount: number | null;
  shippingLabel: string;
  preview: { plan: ReturnType<typeof planOrderEdit> | null; problem: string } | null;
}) {
  const plan = preview?.plan;
  const row = (label: ReactNode, now: number, next?: number, negative = false) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">
        {next !== undefined && Math.abs(next - now) > 0.004 ? (
          <>
            <span className="mr-2 text-muted line-through">{money(now)}</span>
            <span className="font-semibold text-note">{money(next)}</span>
          </>
        ) : (
          <span>{negative ? `−${money(now)}` : money(now)}</span>
        )}
      </dd>
    </div>
  );
  return (
    <div className="mt-4 border-t border-line pt-3">
      <dl className="ml-auto max-w-sm text-sm">
        {row("Subtotal", order.totals.sub, plan?.subtotal)}
        {row(<>Shipping <span className="text-xs">({shippingLabel})</span></>, order.totals.ship, plan?.shipping)}
        {row("Tax", order.totals.tax, plan?.tax)}
        {discount ? row(<>Discount <span className="text-xs">(from import note)</span></>, discount, undefined, true) : null}
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-base">
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">
            {plan && Math.abs(plan.total - order.totals.total) > 0.004 ? (
              <>
                <span className="mr-2 font-normal text-muted line-through">{money(order.totals.total)}</span>
                <span className="text-note">{money(plan.total)}</span>
              </>
            ) : (
              money(order.totals.total)
            )}
          </dd>
        </div>
      </dl>
      {preview ? (
        <p className="mt-2 rounded-xl bg-note-bg px-3 py-2 text-xs text-note">
          {preview.problem
            ? preview.problem
            : `Lines or the method changed, so totals will be recalculated on save (tax at today's rate).${discount ? " The import-note discount is not re-applied; lower a line price if it should carry over." : ""} Otherwise the stored totals stay exactly as they are.`}
        </p>
      ) : null}
    </div>
  );
}

function NoteView({ parsed, raw, onEdit }: { parsed: ReturnType<typeof parseOrderNote>; raw: string; onEdit: () => void }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!raw.trim()) {
    return (
      <button type="button" onClick={onEdit} className="text-left italic text-muted hover:underline">
        No notes. Click to add one.
      </button>
    );
  }
  return (
    <div>
      {parsed.imported ? (
        <p className="mb-2 inline-flex rounded-full bg-cream px-2.5 py-0.5 text-xs font-semibold text-muted">Imported from GoDaddy order history</p>
      ) : null}
      {parsed.fields.length ? (
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[11rem_1fr]">
          {parsed.fields.map((field, index) => {
            const url = field.key === "tracking-#" ? trackingUrl(field.value) : null;
            return (
              <div key={`${field.key}-${index}`} className="contents">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted sm:pt-0.5">{field.label}</dt>
                <dd className="break-words text-sm">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-barn underline">
                      {field.value} <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {parsed.text.length ? (
        <div className={`${parsed.fields.length ? "mt-3 border-t border-line pt-3" : ""} space-y-1 text-sm`}>
          {parsed.text.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
      <button type="button" className="mt-3 text-xs font-semibold text-muted underline" onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? "Hide raw note" : "Show raw note"}
      </button>
      {showRaw ? <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-cream p-3 font-mono text-xs">{raw}</pre> : null}
    </div>
  );
}
