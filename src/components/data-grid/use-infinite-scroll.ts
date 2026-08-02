import { useEffect, useRef } from "react";

/**
 * Attaches an IntersectionObserver to a sentinel element; calls `onLoadMore`
 * when the sentinel becomes visible and `hasMore && !loading`. Guards against
 * duplicate calls while a load is already pending.
 */
export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void | Promise<void>;
}): { sentinelRef: (node: Element | null) => void } {
  const nodeRef = useRef<Element | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pendingRef = useRef(false);
  const stateRef = useRef({ hasMore, loading, onLoadMore });
  stateRef.current = { hasMore, loading, onLoadMore };

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (
        entry !== undefined &&
        entry.isIntersecting &&
        stateRef.current.hasMore &&
        !stateRef.current.loading &&
        !pendingRef.current
      ) {
        pendingRef.current = true;
        void Promise.resolve(stateRef.current.onLoadMore()).finally(() => {
          pendingRef.current = false;
        });
      }
    });
    observerRef.current = observer;
    if (nodeRef.current !== null) observer.observe(nodeRef.current);
    return () => observer.disconnect();
  }, []);

  const sentinelRef = (node: Element | null): void => {
    if (nodeRef.current !== null && observerRef.current !== null) {
      observerRef.current.unobserve(nodeRef.current);
    }
    nodeRef.current = node;
    if (node !== null && observerRef.current !== null) observerRef.current.observe(node);
  };

  return { sentinelRef };
}
