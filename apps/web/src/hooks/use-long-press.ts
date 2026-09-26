import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** How long a press must be held before it counts as a long press. */
const HOLD_MS = 500;

/**
 * How far the pointer may drift and still count as a press. A phone list is
 * scrolled by dragging across exactly the rows this fires on, so without a
 * movement cancel every scroll would trip the long press.
 */
const SLOP_PX = 10;

/** A short buzz on trigger — the only feedback that the hold "took". */
const HAPTIC_MS = 30;

export interface LongPressHandlers {
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly onPointerMove: (event: ReactPointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  readonly onContextMenu: (event: { preventDefault: () => void }) => void;
}

/**
 * Fires `onLongPress` when a pointer is held still on an element.
 *
 * Returns handlers to spread onto the element. `onLongPress` runs while the
 * finger is still down — the press has already succeeded at that point, and
 * waiting for release would make the gesture feel unanswered.
 *
 * The caller is told, via `pressWasLong()`, whether the click that follows
 * came from a long press: a browser still fires `click` after the hold, and
 * without that check a long press would both select the row and open it.
 *
 * Pass `enabled: false` to opt out entirely (no permission, desktop) — the
 * handlers become inert rather than the caller having to branch.
 */
export function useLongPress(
  onLongPress: () => void,
  { enabled = true }: { enabled?: boolean } = {},
): LongPressHandlers & { readonly pressWasLong: () => boolean } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent): void => {
      if (!enabled) return;
      // Secondary buttons open a context menu of their own; leave them alone.
      if (event.button !== 0 && event.pointerType === "mouse") return;
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        try {
          navigator.vibrate?.(HAPTIC_MS);
        } catch {
          // Vibration is unavailable or blocked; the selection still happens.
        }
        onLongPress();
      }, HOLD_MS);
    },
    [enabled, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent): void => {
      const start = origin.current;
      if (start === null) return;
      if (
        Math.abs(event.clientX - start.x) > SLOP_PX ||
        Math.abs(event.clientY - start.y) > SLOP_PX
      ) {
        clear();
      }
    },
    [clear],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    /*
     * iOS answers a long press on text with its own selection callout, and
     * Android with the context menu. Both would sit on top of the selection
     * this gesture is making.
     */
    onContextMenu: (event) => {
      if (enabled) event.preventDefault();
    },
    pressWasLong: () => fired.current,
  };
}
