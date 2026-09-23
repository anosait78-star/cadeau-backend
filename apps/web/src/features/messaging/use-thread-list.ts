import { useCallback, useEffect, useState } from "react";
import { listThreads, type MessageThread } from "./messaging-api";

export type ThreadListState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly threads: readonly MessageThread[];
      readonly nextCursor: string | null;
    };

/** Staff's `GET /threads` list (every conversation in the company), keyset-paged. */
export function useThreadList(): {
  readonly state: ThreadListState;
  readonly reload: () => void;
  readonly loadMore: () => Promise<void>;
  readonly patchThread: (thread: MessageThread) => void;
} {
  const [state, setState] = useState<ThreadListState>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listThreads();
      setState({ kind: "ready", threads: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listThreads({ cursor: state.nextCursor });
    setState({
      kind: "ready",
      threads: [...state.threads, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  }, [state]);

  const patchThread = useCallback((updated: MessageThread): void => {
    setState((current) =>
      current.kind === "ready"
        ? {
            ...current,
            threads: current.threads.map((t) => (t.id === updated.id ? updated : t)),
          }
        : current,
    );
  }, []);

  return { state, reload: () => void load(), loadMore, patchThread };
}
