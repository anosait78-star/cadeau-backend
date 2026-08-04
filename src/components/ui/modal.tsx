import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A centered, large floating dialog (desktop). Built on Radix Dialog (focus
 * trap, escape, a11y, backdrop) like SideSheet/BottomSheet, but centered in
 * the viewport with a fixed-ish width/height instead of anchored to an edge.
 * Header stays pinned; the body is left to the consumer to scroll (so a
 * sticky footer — e.g. form actions — can sit below the scroll area).
 */
export function Modal({
  open,
  onOpenChange,
  title,
  closeLabel = "Close",
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
          <Dialog.Content
            className={cn(
              "flex h-[100dvh] w-screen flex-col rounded-none border-0 border-border bg-card text-card-foreground shadow-lg sm:h-[90vh] sm:w-[90vw] sm:rounded-lg sm:border lg:w-[900px] lg:max-w-[950px]",
              className,
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
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
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
