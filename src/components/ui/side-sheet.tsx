import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A right-anchored panel (desktop). Built on Radix Dialog (focus trap, escape,
 * a11y) but anchored to the logical end edge (right in LTR, left in RTL) with
 * a fixed width instead of BottomSheet's bottom/height/swipe concerns.
 */
export function SideSheet({
  open,
  onOpenChange,
  title,
  closeLabel = "Close",
  children,
  className,
  widthClassName = "max-w-lg",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel?: string;
  children: ReactNode;
  className?: string;
  widthClassName?: string;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-border bg-card p-4 text-card-foreground shadow-lg",
            widthClassName,
            className,
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label={closeLabel}
              >
                ✕
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
