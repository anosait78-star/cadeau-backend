import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /**
   * May return a Promise (e.g. the API call for a delete/archive). The
   * dialog disables its buttons and stays open while it resolves, and stays
   * open (for retry) if it rejects — the caller is responsible for
   * surfacing the error (e.g. via `useToast`).
   */
  readonly onConfirm: () => void | Promise<void>;
  /** Renders the confirm button as destructive (red) instead of primary. */
  readonly destructive?: boolean;
  readonly confirmDisabled?: boolean;
}

/**
 * A modal confirmation for actions that shouldn't happen on a single click
 * (cancel order, delete customer, remove a master-data item, ...). Built on
 * Radix Dialog for focus trap / escape / a11y, matching the `SideSheet` /
 * `BottomSheet` convention.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = false,
  confirmDisabled = false,
}: ConfirmDialogProps): ReactNode {
  const [pending, setPending] = useState(false);

  const handleConfirm = async (): Promise<void> => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
          {...(description === undefined ? { "aria-describedby": undefined } : {})}
        >
          <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
          {description !== undefined ? (
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={destructive ? "destructive" : "primary"}
              size="sm"
              disabled={confirmDisabled || pending}
              onClick={() => void handleConfirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
