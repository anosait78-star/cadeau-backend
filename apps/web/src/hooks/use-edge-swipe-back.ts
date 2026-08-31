import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** How close to the edge a drag must start to count as the back gesture (px). */
const EDGE_ZONE = 28;
/** Fraction of the screen that commits the gesture on release. */
const DISTANCE_RATIO = 0.35;
/** Horizontal speed (px/ms) that commits regardless of distance — a flick. */
const VELOCITY_THRESHOLD = 0.4;
/** How long the screen keeps its transform while gliding back to rest (ms). */
const SETTLE_MS = 200;

export interface EdgeSwipeBack {
  /** How far the screen has been dragged, in px along the inline axis. */
  readonly travel: number;
  /** True while the gesture is live: the caller must not animate the transform. */
  readonly dragging: boolean;
  /**
   * True while the gesture is live *or* settling back. The caller applies its
   * transform only while this holds: a transform — even `translateX(0)` — makes
   * the element a containing block for `position: fixed` descendants, so it must
   * not linger once the screen is at rest.
   */
  readonly active: boolean;
  readonly handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

/** The back gesture starts at the inline-start edge: left in LTR, right in RTL. */
function isAtStartEdge(clientX: number, width: number, rtl: boolean): boolean {
  return rtl ? clientX > width - EDGE_ZONE : clientX < EDGE_ZONE;
}

/**
 * Swipe from the screen's leading edge to go back, with the screen **following
 * the finger** — the gesture is reversible mid-drag, which is what separates it
 * from a swipe that merely fires an action once a threshold is passed.
 *
 * Mirrors automatically: the gesture starts at the left edge and travels right
 * in LTR, and at the right edge travelling left in RTL (the app's default).
 * Release commits on distance or on a flick, and otherwise springs back.
 *
 * `enabled` should be false where there is nothing to go back to (a root
 * destination), so the gesture never moves a screen it cannot leave.
 */
export function useEdgeSwipeBack({
  enabled,
  onBack,
}: {
  enabled: boolean;
  onBack: () => void;
}): EdgeSwipeBack {
  const [travel, setTravel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const start = useRef<{ x: number; y: number; time: number; rtl: boolean } | null>(null);
  const last = useRef<{ x: number; time: number } | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Releasing sends `travel` back to 0; the element keeps its transform for the
  // length of that animation so the screen glides home instead of snapping.
  const reset = useCallback(() => {
    start.current = null;
    last.current = null;
    setDragging(false);
    setTravel((current) => {
      if (current !== 0) {
        setSettling(true);
        if (settleTimer.current !== null) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS);
      }
      return 0;
    });
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  return {
    travel,
    dragging,
    active: dragging || settling,
    handlers: {
      onPointerDown: (event) => {
        if (!enabled || event.pointerType === "mouse") return;
        const rtl = document.documentElement.dir === "rtl";
        if (!isAtStartEdge(event.clientX, window.innerWidth, rtl)) return;
        start.current = { x: event.clientX, y: event.clientY, time: event.timeStamp, rtl };
        last.current = { x: event.clientX, time: event.timeStamp };
        setDragging(true);
      },
      onPointerMove: (event) => {
        const from = start.current;
        if (from === null) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        // A gesture that turns out to be a vertical scroll is handed back.
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
          reset();
          return;
        }
        last.current = { x: event.clientX, time: event.timeStamp };
        // Travel is measured toward the inline-end edge, so it is positive for
        // a real back gesture in either direction; pulling the other way holds.
        const forward = from.rtl ? -dx : dx;
        setTravel(Math.max(forward, 0));
      },
      onPointerUp: (event) => {
        const from = start.current;
        const to = last.current;
        if (from === null || to === null) {
          reset();
          return;
        }
        const forward = (from.rtl ? -1 : 1) * (to.x - from.x);
        const elapsed = Math.max(to.time - from.time, 1);
        const velocity = forward / elapsed;
        reset();
        if (forward > window.innerWidth * DISTANCE_RATIO || velocity > VELOCITY_THRESHOLD) {
          onBack();
        }
        void event;
      },
      onPointerCancel: () => reset(),
    },
  };
}
