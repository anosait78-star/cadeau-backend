import { useEffect, useRef, useState } from "react";
import { searchMentionableOrders, type MentionableOrder } from "./messaging-api";

/** The handoff's debounce for the `@` picker (M17.6). */
const DEBOUNCE_MS = 250;

/**
 * Debounced search against `GET /threads/{id}/mentionable-orders`, driving the
 * `@` popover. `query === null` means the picker is closed — the hook then
 * does nothing and reports an empty result, so the composer can unconditionally
 * mount this hook rather than mounting/unmounting it with the popover.
 */
export function useMentionableOrders(
  threadId: string | null,
  query: string | null,
): { readonly results: readonly MentionableOrder[]; readonly loading: boolean } {
  const [results, setResults] = useState<readonly MentionableOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (threadId === null || query === null) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      void searchMentionableOrders(threadId, query.length > 0 ? query : undefined)
        .then((page) => {
          if (requestId.current !== id) return; // a newer keystroke superseded this call
          setResults(page.data);
        })
        .catch(() => {
          if (requestId.current === id) setResults([]);
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [threadId, query]);

  return { results, loading };
}
