import { useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

type Direction = "up" | "down" | "left" | "right";

interface SwipeOptions {
  onSwipe?: (direction: Direction) => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Minimum travel (px) before a gesture counts as a swipe. */
  threshold?: number;
}

export interface SwipeHandlers {
  onTouchStart: (event: ReactTouchEvent) => void;
  onTouchMove: (event: ReactTouchEvent) => void;
  onTouchEnd: () => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Dependency-free touch swipe detection. Returns touch handlers to spread onto an
 * element; on release it resolves the dominant axis and fires the matching
 * callback once the travel exceeds `threshold`. Used for swipe-to-dismiss sheets.
 */
export function useSwipe(options: SwipeOptions): SwipeHandlers {
  const start = useRef<Point | null>(null);
  const current = useRef<Point | null>(null);
  const threshold = options.threshold ?? 50;

  return {
    onTouchStart: (event) => {
      const touch = event.touches[0];
      if (touch === undefined) return;
      start.current = { x: touch.clientX, y: touch.clientY };
      current.current = start.current;
    },
    onTouchMove: (event) => {
      const touch = event.touches[0];
      if (touch === undefined) return;
      current.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: () => {
      const from = start.current;
      const to = current.current;
      start.current = null;
      current.current = null;
      if (from === null || to === null) return;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

      const direction: Direction =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";

      options.onSwipe?.(direction);
      const handlers: Record<Direction, (() => void) | undefined> = {
        up: options.onSwipeUp,
        down: options.onSwipeDown,
        left: options.onSwipeLeft,
        right: options.onSwipeRight,
      };
      handlers[direction]?.();
    },
  };
}
