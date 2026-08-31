import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks whether the top of the page has scrolled away, so a header can collapse
 * from a large title into a compact bar (the iOS pattern).
 *
 * Uses an `IntersectionObserver` on a zero-height sentinel rather than a `scroll`
 * listener: the observer fires only at the crossing, off the main thread, so the
 * collapse costs nothing while the user is actually scrolling.
 *
 * Attach {@link sentinelRef} to an element at the very top of the scrolling
 * content; {@link collapsed} is `true` once that element leaves the viewport.
 */
export function useScrollCollapse(): {
  sentinelRef: (node: HTMLElement | null) => void;
  collapsed: boolean;
} {
  const [collapsed, setCollapsed] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // A callback ref (not `useRef`) so the observer re-attaches when the sentinel
  // element itself changes — the shell swaps it per route.
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (node === null || typeof IntersectionObserver !== "function") {
      setCollapsed(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(entry !== undefined && !entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { sentinelRef, collapsed };
}
