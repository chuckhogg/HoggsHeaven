import { createFileRoute } from "@tanstack/react-router";
import { AdminOrders } from "@/components/admin-orders";
import { AdminProducts } from "@/components/admin-products";
import { AdminShipping } from "@/components/admin-shipping";
import { DeskGate } from "@/components/desk-gate";
import { Shell } from "@/components/shell";
import { UserButton } from "@/lib/auth/gates";

type Tab = "orders" | "listings" | "shipping";

export const Route = createFileRoute("/admin")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    search.tab === "listings" || search.tab === "shipping" ? { tab: search.tab } : {},
  component: AdminPage,
});

function AdminPage() {
  return (
    <Shell>
      <DeskGate>
        <Desk />
      </DeskGate>
    </Shell>
  );
}

const tabClass = (active: boolean) =>
  active
    ? "inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-paper"
    : "inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4";

function Desk() {
  const { tab = "orders" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setTab = (next: Tab) => void navigate({ search: next === "orders" ? {} : { tab: next }, replace: true });
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">Private</p>
          <h1 className="text-4xl">Admin</h1>
        </div>
        <UserButton />
      </div>
      <div className="mt-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={tabClass(tab === "orders")} onClick={() => setTab("orders")}>Orders</button>
          <button type="button" className={tabClass(tab === "listings")} onClick={() => setTab("listings")}>Listings</button>
          <button type="button" className={tabClass(tab === "shipping")} onClick={() => setTab("shipping")}>Shipping</button>
        </div>
        <div className="mt-6">{tab === "orders" ? <AdminOrders /> : tab === "listings" ? <AdminProducts /> : <AdminShipping />}</div>
      </div>
    </div>
  );
}
