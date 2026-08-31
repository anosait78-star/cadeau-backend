import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** How far past the top edge the sheet may be dragged, and how hard it resists. */
const RUBBER_BAND = 0.35;
/** Fraction of the sheet's own height that counts as "dragged away". */
const DISTANCE_RATIO = 0.25;
/** Downward speed (px/ms) that dismisses regardless of distance — a flick. */
const VELOCITY_THRESHOLD = 0.5;

export interface DragDismiss {
  /** Current vertical offset in px (0 at rest, positive = dragged down). */
  readonly offset: number;
  /** True while a finger is down: the caller must not animate the transform. */
  readonly dragging: boolean;
  readonly handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

/**
 * Drag-to-dismiss for a bottom sheet: the surface **follows the finger** rather
 * than waiting for a threshold to be crossed, which is the whole difference
 * between a sheet that feels native and one that feels like a web modal.
 *
 * Dragging up past the top is resisted (rubber-banding) instead of blocked, so
 * the gesture never feels dead. Release dismisses on either distance (a quarter
 * of the sheet) or speed (a flick), and otherwise springs back to rest.
 *
 * A drag that starts inside a scrolled region is ignored, so scrolling the
 * sheet's own content never drags the sheet.
 */
export function useDragDismiss(onDismiss: () => void): DragDismiss {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; time: number } | null>(null);
  const last = useRef<{ y: number; time: number } | null>(null);

  const end = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const from = start.current;
      const to = last.current;
      start.current = null;
      last.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);

      if (from === null || to === null || cancelled) {
        setOffset(0);
        return;
      }
      const travel = to.y - from.y;
      const elapsed = Math.max(to.time - from.time, 1);
      const velocity = travel / elapsed;
      const height = event.currentTarget.getBoundingClientRect().height || 1;

      if (travel > height * DISTANCE_RATIO || velocity > VELOCITY_THRESHOLD) {
        onDismiss();
      }
      setOffset(0);
    },
    [onDismiss],
  );

  return {
    offset,
    dragging,
    handlers: {
      onPointerDown: (event) => {
        // Touch only: a mouse drag on a sheet is not a gesture anyone makes, and
        // capturing it would break text selection.
        if (event.pointerType === "mouse") return;
        // Let the content scroll instead of dragging the sheet away under it.
        if (event.currentTarget.scrollTop > 0) return;
        const point = { y: event.clientY, time: event.timeStamp };
        start.current = point;
        last.current = point;
        setDragging(true);
      },
      onPointerMove: (event) => {
        const from = start.current;
        if (from === null) return;
        const travel = event.clientY - from.y;
        last.current = { y: event.clientY, time: event.timeStamp };
        // Upward travel is resisted rather than ignored — the sheet gives a
        // little, then holds.
        setOffset(travel >= 0 ? travel : travel * RUBBER_BAND);
      },
      onPointerUp: (event) => end(event, false),
      onPointerCancel: (event) => end(event, true),
    },
  };
}
