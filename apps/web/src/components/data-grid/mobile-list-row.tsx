import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
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
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  className?: string;
}): ReactNode {
  const content = (
    <>
      {leading === undefined ? null : <div className="shrink-0">{leading}</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-body font-semibold text-foreground">{title}</div>
        {secondary === undefined ? null : (
          <div className="truncate text-caption text-muted-foreground">{secondary}</div>
        )}
      </div>
      {trailing === undefined ? null : (
        <div className="shrink-0 text-end text-caption text-muted-foreground">{trailing}</div>
      )}
      {onPress === undefined ? null : (
        // Points the way the row opens, which is leftwards in RTL.
        <ChevronLeft
          className="h-4 w-4 shrink-0 text-muted-foreground ltr:rotate-180"
          aria-hidden="true"
        />
      )}
    </>
  );

  const shared = cn("flex w-full items-center gap-3 px-4 py-3 text-start", className);

  if (onPress === undefined) return <div className={shared}>{content}</div>;

  return (
    <button type="button" onClick={onPress} className={cn(shared, "pressable active:bg-muted")}>
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
