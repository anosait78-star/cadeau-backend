import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, type ReactNode } from "react";
import { useDragDismiss } from "@/hooks/use-drag-dismiss";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";

/** How tall the sheet stands. `auto` hugs its content up to a safe maximum. */
export type SheetDetent = "auto" | "medium" | "large";

const DETENT_CLASS: Record<SheetDetent, string> = {
  auto: "max-h-[85dvh]",
  medium: "h-[50dvh]",
  large: "h-[92dvh]",
};

/**
 * A bottom sheet (mobile). Built on Radix Dialog (focus trap, escape, a11y) but
 * anchored to the bottom edge with a grab handle and **drag to dismiss**: the
 * surface tracks the finger and is released on distance or on a flick
 * ({@link useDragDismiss}), rather than jumping shut at a fixed threshold.
 *
 * `detent` picks how tall it stands — `auto` for a short menu, `medium`/`large`
 * for content that should open to a predictable height. A title is required for
 * accessibility.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  className,
  detent = "auto",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
  detent?: SheetDetent;
}): ReactNode {
  const drag = useDragDismiss(() => onOpenChange(false));

  useEffect(() => {
    if (open) haptic("impact");
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          {...drag.handlers}
          style={{
            transform: drag.offset === 0 ? undefined : `translateY(${drag.offset}px)`,
            // While the finger is down the surface must track it exactly; the
            // spring back to rest is what gets animated.
            transition: drag.dragging ? "none" : undefined,
          }}
          className={cn(
            // `overscroll-contain` keeps a scroll inside the sheet from chaining
            // to the page behind it; the bottom padding clears the home indicator.
            // The bottom padding clears the home indicator, and grows to clear
            // the keyboard whenever a field inside the sheet has focus.
            "fixed inset-x-0 bottom-0 z-50 overflow-auto overscroll-contain rounded-t-2xl border-t border-border bg-card p-4 pb-[calc(1.5rem+var(--safe-bottom)+var(--keyboard-inset,0px))] text-card-foreground shadow-lg",
            "touch-pan-y transition-transform duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none",
            DETENT_CLASS[detent],
            className,
          )}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
          <Dialog.Title className="mb-3 text-sm font-semibold">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
