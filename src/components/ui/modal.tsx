import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The five standard dialog sizes (roadmap §4.2) — every Modal call site must
 * pick one instead of declaring an ad hoc width. `fullscreen` fills the
 * viewport on every breakpoint (wizards, complex multi-step flows); the rest
 * fall back to fullscreen on mobile and cap at their max width from `sm:` up.
 */
const sizeClassName = {
  sm: "sm:w-[420px]",
  md: "sm:w-[560px]",
  lg: "sm:w-[760px]",
  xl: "sm:w-[960px]",
  fullscreen: "sm:w-screen sm:h-[100dvh] sm:rounded-none sm:border-0",
} as const;

export type ModalSize = keyof typeof sizeClassName;

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
  size = "lg",
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel?: string;
  /** One of the five standard sizes (§4.2). Defaults to `lg` (760px). */
  size?: ModalSize;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
          <Dialog.Content
            className={cn(
              "flex h-[100dvh] w-screen flex-col rounded-none border-0 border-border bg-card text-card-foreground shadow-lg",
              "sm:h-[90vh] sm:max-h-[720px] sm:rounded-lg sm:border",
              "modal-content-motion",
              sizeClassName[size],
              className,
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-6 py-5">
              <Dialog.Title className="text-h3">{title}</Dialog.Title>
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
