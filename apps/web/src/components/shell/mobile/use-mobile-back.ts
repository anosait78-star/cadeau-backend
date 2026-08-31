import { useCallback } from "react";
import { useNavigate } from "react-router";

/**
 * Going back on mobile, for both the header control and the edge-swipe gesture,
 * so the two can never disagree.
 *
 * The browser stamps each history entry with its index. `0` proves this entry is
 * the first of the session — a deep link, a shared URL, a reload — where going
 * back would leave the app entirely; there the parent path is the right
 * destination instead. Any other value (including none, as under a memory
 * router in tests) means a real previous entry exists.
 */
export function useMobileBack(): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx;
    if (index === 0) {
      void navigate("..", { relative: "path" });
      return;
    }
    void navigate(-1);
  }, [navigate]);
}
