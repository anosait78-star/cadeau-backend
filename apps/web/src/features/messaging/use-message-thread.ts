import { useCallback, useEffect, useRef, useState } from "react";
import {
  listMessages,
  markThreadRead,
  sendMessage,
  type Message,
  type SendMessageInput,
} from "./messaging-api";

/** How often to re-poll the open thread for new messages (handoff §M17.6). */
const POLL_INTERVAL_MS = 15_000;
/** A wide enough page that an ordinary poll interval catches every new message in one call. */
const POLL_LIMIT = 50;

export type MessageThreadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      /** Oldest first — the order a chat reads in, top to bottom. */
      readonly messages: readonly Message[];
      readonly hasOlder: boolean;
    };

/** Newest-first API pages, reversed to the ascending order a chat renders in. */
function ascending(page: readonly Message[]): Message[] {
  return [...page].reverse();
}

/**
 * Drives one open conversation (EPIC-17 M17.6): the message list (oldest at
 * the top, scrolling up loads older pages), sending, and a background refresh.
 *
 * Refresh is a flat 15s interval, paused while the tab is hidden
 * (`visibilitychange`) — the handoff also asks for a refetch "when a
 * `message.received` notification arrives," but wiring the notification
 * bell's own poll into this one would need a new cross-feature event bus for
 * a single consumer; a 15s ceiling already bounds the same staleness a
 * notification-triggered refetch would fix, so this stays the one poll loop.
 */
export function useMessageThread(threadId: string | null): {
  readonly state: MessageThreadState;
  readonly loadOlder: () => Promise<void>;
  readonly send: (input: SendMessageInput) => Promise<Message>;
  readonly markRead: () => Promise<void>;
  readonly reload: () => void;
} {
  const [state, setState] = useState<MessageThreadState>({ kind: "loading" });
  const olderCursorRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);

  const load = useCallback(async (id: string): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listMessages(id, { limit: POLL_LIMIT });
      olderCursorRef.current = page.page.nextCursor;
      setState({ kind: "ready", messages: ascending(page.data), hasOlder: page.page.hasMore });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    olderCursorRef.current = null;
    if (threadId === null) {
      setState({ kind: "loading" });
      return;
    }
    void load(threadId);
  }, [threadId, load]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (threadId === null || loadingOlderRef.current) return;
    const cursor = olderCursorRef.current;
    if (cursor === null) return;
    loadingOlderRef.current = true;
    try {
      const page = await listMessages(threadId, { cursor, limit: POLL_LIMIT });
      olderCursorRef.current = page.page.nextCursor;
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              messages: [...ascending(page.data), ...current.messages],
              hasOlder: page.page.hasMore,
            }
          : current,
      );
    } finally {
      loadingOlderRef.current = false;
    }
  }, [threadId]);

  // Background refresh: the newest page, merged in by id so an older page
  // already loaded through `loadOlder` is never disturbed.
  useEffect(() => {
    if (threadId === null) return;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (document.hidden) return;
      try {
        const page = await listMessages(threadId, { limit: POLL_LIMIT });
        if (cancelled) return;
        setState((current) => {
          if (current.kind !== "ready") return current;
          const known = new Set(current.messages.map((m) => m.id));
          const fresh = ascending(page.data).filter((m) => !known.has(m.id));
          if (fresh.length === 0) return current;
          return { ...current, messages: [...current.messages, ...fresh] };
        });
      } catch {
        // A missed poll is invisible — the next tick or a manual reload recovers.
      }
    };

    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const onVisible = (): void => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [threadId]);

  const send = useCallback(
    async (input: SendMessageInput): Promise<Message> => {
      if (threadId === null) throw new Error("No open thread to send into.");
      const message = await sendMessage(threadId, input);
      setState((current) =>
        current.kind === "ready"
          ? { ...current, messages: [...current.messages, message] }
          : current,
      );
      return message;
    },
    [threadId],
  );

  const markRead = useCallback(async (): Promise<void> => {
    if (threadId === null) return;
    await markThreadRead(threadId);
  }, [threadId]);

  const reload = useCallback((): void => {
    if (threadId !== null) void load(threadId);
  }, [threadId, load]);

  return { state, loadOlder, send, markRead, reload };
}
