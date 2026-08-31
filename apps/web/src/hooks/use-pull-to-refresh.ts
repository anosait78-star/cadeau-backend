import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** How far the list must be pulled before releasing triggers a refresh (px). */
const TRIGGER_DISTANCE = 72;
/** How far it can be pulled at all — past the trigger it stiffens. */
const MAX_PULL = 110;
/** Resistance applied to the pull, so the list never tracks the finger 1:1. */
const RESISTANCE = 0.5;

export interface PullToRefresh {
  /** Current pull distance in px (0 at rest). */
  readonly distance: number;
  /** True once the pull is far enough that releasing will refresh. */
  readonly armed: boolean;
  /** True while the refresh itself is running. */
  readonly refreshing: boolean;
  readonly handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
}

/**
 * Pull down at the top of a list to reload it.
 *
 * Only starts when the page is already scrolled to the top, so it can never
 * fight a normal scroll. The pull is damped and capped: the indicator moves less
 * than the finger and stiffens past the trigger point, which is what tells the
 * user they have pulled far enough without any text saying so.
 */
export function usePullToRefresh(onRefresh: () => void | Promise<void>): PullToRefresh {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const finish = useCallback(() => {
    const pulled = distance;
    startY.current = null;
    setDistance(0);
    if (pulled < TRIGGER_DISTANCE || refreshing) return;

    setRefreshing(true);
    void (async () => {
      try {
        await onRefreshRef.current();
      } finally {
        setRefreshing(false);
      }
    })();
  }, [distance, refreshing]);

  return {
    distance,
    armed: distance >= TRIGGER_DISTANCE,
    refreshing,
    handlers: {
      onPointerDown: (event) => {
        if (event.pointerType === "mouse" || refreshing) return;
        // A pull is only a pull at the very top; anywhere else it is a scroll.
        if (window.scrollY > 0) return;
        startY.current = event.clientY;
      },
      onPointerMove: (event) => {
        const from = startY.current;
        if (from === null) return;
        const travel = event.clientY - from;
        if (travel <= 0) {
          setDistance(0);
          return;
        }
        setDistance(Math.min(travel * RESISTANCE, MAX_PULL));
      },
      onPointerUp: finish,
      onPointerCancel: () => {
        startY.current = null;
        setDistance(0);
      },
    },
  };
}
