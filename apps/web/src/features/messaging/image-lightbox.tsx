import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Attachment } from "./messaging-api";

/**
 * Full-screen viewer for a message's images (EPIC-17 M17.6). A bare Radix
 * Dialog rather than the shared `Modal` — `Modal` always renders a titled
 * header bar, which would crowd a picture-only view; this keeps the same
 * focus-trap/escape/backdrop behavior with a minimal chrome of its own.
 */
export function ImageLightbox({
  attachments,
  index,
  onIndexChange,
  onClose,
  closeLabel,
  previousLabel,
  nextLabel,
}: {
  readonly attachments: readonly Attachment[];
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly previousLabel: string;
  readonly nextLabel: string;
}): ReactNode {
  const current = attachments[index];
  if (current === undefined) return null;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/90" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col outline-none">
          <Dialog.Title className="sr-only">{closeLabel}</Dialog.Title>
          <div className="flex shrink-0 items-center justify-end p-3">
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
            <img
              src={current.url}
              alt=""
              className="max-h-full max-w-full rounded-md object-contain"
            />
            {attachments.length > 1 ? (
              <>
                <NavButton
                  side="start"
                  disabled={index === 0}
                  label={previousLabel}
                  onClick={() => onIndexChange(index - 1)}
                />
                <NavButton
                  side="end"
                  disabled={index === attachments.length - 1}
                  label={nextLabel}
                  onClick={() => onIndexChange(index + 1)}
                />
                <div
                  dir="ltr"
                  className="absolute bottom-4 start-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white tabular-nums"
                >
                  {index + 1} / {attachments.length}
                </div>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NavButton({
  side,
  disabled,
  label,
  onClick,
}: {
  readonly side: "start" | "end";
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): ReactNode {
  // Points toward the reading direction: "previous" is start-side (chevron
  // pointing at the reading start), "next" is end-side — fixed regardless of
  // RTL/LTR because the `start-`/`end-` placement already mirrors.
  const Icon = side === "start" ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white",
        "hover:bg-black/60 disabled:pointer-events-none disabled:opacity-30",
        side === "start" ? "start-3" : "end-3",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
