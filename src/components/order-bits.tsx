import type { OrderStatus } from "@/lib/farm-store";
import { statusLabel } from "@/lib/farm-store";

const STATUS_STYLE: Record<OrderStatus, string> = {
  "awaiting-payment": "bg-note-bg text-note border-gold/60",
  paid: "bg-moss/10 text-moss border-moss/40",
  packing: "bg-paper text-ink border-line",
  shipped: "bg-paper text-ink border-ink/30",
  "ready-for-pickup": "bg-gold/20 text-note border-gold/60",
  completed: "bg-moss/15 text-moss border-moss/40",
  cancelled: "bg-barn/10 text-barn-deep border-barn/30",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {statusLabel(status)}
    </span>
  );
}
