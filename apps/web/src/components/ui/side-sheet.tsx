import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A right-anchored panel (desktop). Built on Radix Dialog (focus trap, escape,
 * a11y) but anchored to the logical end edge (right in LTR, left in RTL) with
 * a fixed width instead of BottomSheet's bottom/height/swipe concerns.
 *
 * The header (title, optional badge/subtitle and the `headerExtra` slot) is
 * pinned; everything the consumer renders as `children` lives in the scroll
 * region below it, so long content never drags the chrome out of view.
 */
export function SideSheet({
  open,
  onOpenChange,
  title,
  titleBadge,
  subtitle,
  headerExtra,
  closeLabel = "Close",
  children,
  className,
  widthClassName = "max-w-lg",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Chip rendered next to the title (e.g. a status badge). */
  titleBadge?: ReactNode;
  /** Quiet context line under the title (e.g. customer · date). */
  subtitle?: ReactNode;
  /** Pinned block below the title row (e.g. the headline figure). */
  headerExtra?: ReactNode;
  closeLabel?: string;
  children: ReactNode;
  className?: string;
  widthClassName?: string;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay-motion fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "sheet-content-motion fixed inset-y-0 end-0 z-50 flex w-full flex-col overflow-hidden",
            "border-s border-border bg-card text-card-foreground shadow-2xl",
            "sm:rounded-s-2xl",
            widthClassName,
            className,
          )}
        >
          <div className="shrink-0 border-b border-border px-5 pb-4 pt-4 sm:px-6 sm:pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Dialog.Title className="text-xl font-bold leading-tight tracking-tight tabular-nums sm:text-[1.375rem]">
                    {title}
                  </Dialog.Title>
                  {titleBadge}
                </div>
                {subtitle !== undefined && subtitle !== null ? (
                  <div className="min-w-0 text-sm text-muted-foreground">{subtitle}</div>
                ) : null}
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    "-me-1 shrink-0 rounded-lg border border-transparent p-2 text-muted-foreground",
                    "transition-colors duration-[var(--motion-hover)]",
                    "hover:border-border hover:bg-muted hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  aria-label={closeLabel}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            {headerExtra !== undefined && headerExtra !== null ? (
              <div className="mt-4">{headerExtra}</div>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
