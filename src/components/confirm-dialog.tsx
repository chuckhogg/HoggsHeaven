import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";

/** Small accessible confirm dialog (Radix AlertDialog) in the farm's styling. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-paper p-5 shadow-xl">
          <AlertDialog.Title className={`text-2xl ${danger ? "text-barn" : ""}`}>{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm text-muted">{children}</div>
          </AlertDialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel className="inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold" onClick={onCancel}>
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className={`inline-flex min-h-11 items-center rounded-full px-5 font-semibold text-paper ${danger ? "bg-barn hover:bg-barn-deep" : "bg-ink"}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
