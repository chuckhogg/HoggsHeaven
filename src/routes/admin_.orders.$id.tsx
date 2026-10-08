import { createFileRoute } from "@tanstack/react-router";
import { AdminOrderView } from "@/components/admin-order-view";
import { DeskGate } from "@/components/desk-gate";
import { Shell } from "@/components/shell";

/** The farm desk's order view: /admin/orders/<order #>, or /admin/orders/new to add one. */
export const Route = createFileRoute("/admin_/orders/$id")({
  head: ({ params }) => ({ meta: [{ title: `${params.id === "new" ? "New order" : `Order ${params.id}`} · Farm desk` }] }),
  component: OrderViewPage,
});

function OrderViewPage() {
  const { id } = Route.useParams();
  return (
    <Shell>
      <DeskGate title="Order">
        <AdminOrderView key={id} id={id} />
      </DeskGate>
    </Shell>
  );
}
