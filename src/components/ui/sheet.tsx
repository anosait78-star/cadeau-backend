import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useSwipe } from "@/hooks/use-swipe";
import { cn } from "@/lib/cn";

/**
 * A bottom sheet (mobile). Built on Radix Dialog (focus trap, escape, a11y) but
 * anchored to the bottom edge with a grab handle and **swipe-down to dismiss**.
 * A title is required for accessibility.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const swipe = useSwipe({ onSwipeDown: () => onOpenChange(false), threshold: 60 });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          onTouchStart={swipe.onTouchStart}
          onTouchMove={swipe.onTouchMove}
          onTouchEnd={swipe.onTouchEnd}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-auto rounded-t-2xl border-t border-border bg-card p-4 pb-6 text-card-foreground shadow-lg",
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
