import { Check, ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useLongPress } from "@/hooks/use-long-press";
import { cn } from "@/lib/cn";

/**
 * A tappable list row in the inset-grouped idiom: a leading element (thumbnail,
 * avatar, order number), a title with a secondary line under it, and a trailing
 * value, followed by a chevron that says the row opens something.
 *
 * Why this shape rather than a grid of label/value pairs: on a phone the eye
 * scans a single leading column and one strong title per row. A card full of
 * labelled fields is a desktop table with its columns stacked — readable, but it
 * gives no hierarchy and nothing to aim a thumb at.
 */
export function MobileListRow({
  leading,
  title,
  secondary,
  trailing,
  onPress,
  onLongPress,
  selectionMode = false,
  selected = false,
  selectLabel,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /**
   * Held down rather than tapped. While a list is in selection mode a plain
   * tap toggles selection too, so this only has to start it.
   */
  onLongPress?: () => void;
  /** Swaps the leading element for a checkmark and the chevron for nothing. */
  selectionMode?: boolean;
  selected?: boolean;
  /** Accessible name for the row while it is selectable. */
  selectLabel?: string;
  className?: string;
}): ReactNode {
  const longPress = useLongPress(() => onLongPress?.(), { enabled: onLongPress !== undefined });
  const content = (
    <>
      {/*
        In selection mode the tick takes the leading slot rather than sitting
        beside it: a row that grew a column would shift every other row's text
        sideways the moment the mode turned on.
      */}
      {selectionMode ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted/40 text-transparent",
          )}
        >
          <Check className="h-5 w-5" />
        </span>
      ) : leading === undefined ? null : (
        <div className="shrink-0">{leading}</div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-body font-semibold text-foreground">{title}</div>
        {secondary === undefined ? null : (
          <div className="truncate text-caption text-muted-foreground">{secondary}</div>
        )}
      </div>
      {trailing === undefined ? null : (
        <div className="shrink-0 text-end text-caption text-muted-foreground">{trailing}</div>
      )}
      {/* The chevron says "this opens something", which is untrue mid-selection. */}
      {onPress === undefined || selectionMode ? null : (
        // Points the way the row opens, which is leftwards in RTL.
        <ChevronLeft
          className="h-4 w-4 shrink-0 text-muted-foreground ltr:rotate-180"
          aria-hidden="true"
        />
      )}
    </>
  );

  const shared = cn(
    "flex w-full items-center gap-3 px-4 py-3 text-start",
    selectionMode && selected && "bg-primary/5",
    className,
  );

  if (onPress === undefined) return <div className={shared}>{content}</div>;

  return (
    <button
      type="button"
      onClick={onPress}
      {...(onLongPress === undefined
        ? {}
        : {
            onPointerDown: longPress.onPointerDown,
            onPointerMove: longPress.onPointerMove,
            onPointerUp: longPress.onPointerUp,
            onPointerCancel: longPress.onPointerCancel,
            onContextMenu: longPress.onContextMenu,
          })}
      {...(selectionMode ? { role: "checkbox" as const, "aria-checked": selected } : {})}
      {...(selectionMode && selectLabel !== undefined
        ? // Only while selecting: outside it the row opens the record, and
          // naming it "select…" would misdescribe what a tap does.
          { "aria-label": selectLabel }
        : {})}
      className={cn(
        shared,
        "pressable active:bg-muted",
        // A held press must not also start the OS text-selection callout.
        onLongPress === undefined ? undefined : "select-none [-webkit-touch-callout:none]",
      )}
    >
      {content}
    </button>
  );
}

/**
 * Groups rows into one inset card with hairline separators between them.
 *
 * The separator starts after the leading column instead of spanning the full
 * width (`.list-inset-separators` in `globals.css` draws it as a pseudo-element,
 * so the row's own padding is untouched). That inset is the detail that makes a
 * grouped list read as a single object rather than a stack of separate bars.
 * Pass `flush` for a group whose rows have no leading element.
 */
export function MobileListGroup({
  children,
  flush = false,
  className,
}: {
  children: ReactNode;
  flush?: boolean;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        flush ? "list-flush-separators" : "list-inset-separators",
        className,
      )}
    >
      {children}
    </div>
  );
}
