import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useCallback, useEffect, useRef } from "react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ref,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>): ReactNode {
  const listRef = useRef<HTMLDivElement | null>(null);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;

    // Inside a Radix Dialog/Sheet, react-remove-scroll locks the page by
    // cancelling `touchmove` from a listener on `document`. Its "is this
    // swipe allowed?" check decides on the very first touchmove, which on a
    // real finger is often a pixel of vertical jitter — so a horizontal
    // swipe on the tab strip got cancelled and the strip never scrolled on a
    // phone. The strip is a pure scroller (nothing inside is draggable), so
    // when it actually overflows we keep its touchmoves from reaching that
    // document listener and let the browser scroll it natively.
    const onTouchMove = (event: TouchEvent): void => {
      if (list.scrollWidth > list.clientWidth) event.stopPropagation();
    };
    list.addEventListener("touchmove", onTouchMove, { passive: true });

    // Keep the selected tab visible when it changes (click, arrow keys or a
    // controlled `value`). Radix flips `data-state` on the triggers, so watch
    // that rather than requiring every consumer to wire `onValueChange`.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target;
        if (target instanceof HTMLElement && target.dataset["state"] === "active") {
          // jsdom (tests) does not implement scrollIntoView.
          if (typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
          }
          break;
        }
      }
    });
    observer.observe(list, { subtree: true, attributes: true, attributeFilter: ["data-state"] });

    return () => {
      list.removeEventListener("touchmove", onTouchMove);
      observer.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={setRef}
      className={cn(
        // `overscroll-x-contain`: reaching the strip's edge must not hand the
        // swipe on to the page behind it.
        "flex gap-1 overflow-x-auto overscroll-x-contain border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref !== null && ref !== undefined) ref.current = value;
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>): ReactNode {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors",
        "data-[state=active]:border-primary data-[state=active]:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>): ReactNode {
  return (
    <TabsPrimitive.Content
      className={cn("flex-1 overflow-auto py-3 focus-visible:outline-none", className)}
      {...props}
    />
  );
}
