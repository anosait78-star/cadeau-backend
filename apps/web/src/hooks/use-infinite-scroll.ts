import { useCallback, useEffect, useRef } from "react";

/**
 * Loads the next page when a sentinel at the end of a list comes into view.
 *
 * The sentinel is placed *below* the last row and given a margin, so the fetch
 * starts while the user is still reading the rows above it and the next page is
 * usually there before they reach the bottom — the difference between a list
 * that continues and one that stops to ask.
 *
 * Guards against re-entry: while a load is in flight the observer's callback is
 * ignored, so a fast scroll cannot queue several pages at once.
 *
 * Returns `null` for `sentinelRef` support detection via {@link supported} —
 * callers keep an explicit "load more" control for that case.
 */
export function useInfiniteScroll({
  hasMore,
  onLoadMore,
  rootMargin = "300px",
}: {
  hasMore: boolean;
  onLoadMore: () => void | Promise<void>;
  rootMargin?: string;
}): { sentinelRef: (node: HTMLElement | null) => void; supported: boolean } {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(false);
  // Read through refs so a new inline callback (or a changed flag) never tears
  // down and rebuilds the observer mid-scroll.
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const supported = typeof IntersectionObserver === "function";

  const attach = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      observerRef.current?.disconnect();
      if (node === null || !supported) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry === undefined || !entry.isIntersecting) return;
          if (!hasMoreRef.current || loadingRef.current) return;
          loadingRef.current = true;
          void (async () => {
            try {
              await onLoadMoreRef.current();
            } finally {
              loadingRef.current = false;
            }
          })();
        },
        { rootMargin },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [rootMargin, supported],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { sentinelRef: attach, supported };
}
