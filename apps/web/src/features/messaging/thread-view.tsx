import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { useMessageThread } from "./use-message-thread";
import type { ThreadStatus } from "./messaging-api";

/**
 * One open conversation (EPIC-17 M17.6): the scrollable message list plus the
 * composer, shared verbatim by the staff thread panel and the vendor's own
 * conversation tab — everything either side needs differs only in the
 * *container* around this (a `SideSheet` for staff, the full page for a
 * vendor), never in how a message renders.
 */
export function ThreadView({
  threadId,
  status,
  currentUserId,
  orderHref,
  onRead,
}: {
  readonly threadId: string;
  readonly status: ThreadStatus;
  readonly currentUserId: string | null;
  /** Builds the link for one order mention, or `undefined` to render it unlinked. */
  readonly orderHref?: (orderId: string) => string | undefined;
  /** Called once the caller's read cursor has moved — lets a thread list clear its own unread badge. */
  readonly onRead?: () => void;
}): ReactNode {
  const { t } = useI18n();
  const { state, loadOlder, send, markRead, reload } = useMessageThread(threadId);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollInfoRef = useRef({ top: 0, height: 0 });
  const firstMessageIdRef = useRef<string | null>(null);
  const openedThreadRef = useRef<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // A fresh conversation: forget the previous one's scroll anchoring, and mark
  // this one read now that its messages are on screen.
  useEffect(() => {
    if (openedThreadRef.current === threadId) return;
    openedThreadRef.current = threadId;
    firstMessageIdRef.current = null;
    void markRead().then(() => onRead?.());
  }, [threadId, markRead, onRead]);

  useLayoutEffect(() => {
    if (state.kind !== "ready") return;
    const container = containerRef.current;
    if (container === null) return;
    const firstId = state.messages[0]?.id ?? null;

    if (firstMessageIdRef.current === null) {
      // First render of this thread's messages: land at the newest one.
      container.scrollTop = container.scrollHeight;
    } else if (firstId !== firstMessageIdRef.current) {
      // Older messages were prepended — keep whatever the reader was looking
      // at in place instead of yanking the view to the new top.
      container.scrollTop =
        scrollInfoRef.current.top + (container.scrollHeight - scrollInfoRef.current.height);
    } else {
      container.scrollTop = container.scrollHeight;
    }
    firstMessageIdRef.current = firstId;
  }, [state]);

  const onScroll = (): void => {
    const container = containerRef.current;
    if (container === null) return;
    scrollInfoRef.current = { top: container.scrollTop, height: container.scrollHeight };
  };

  const handleLoadOlder = async (): Promise<void> => {
    onScroll();
    setLoadingOlder(true);
    try {
      await loadOlder();
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.kind === "loading" ? <LoadingState /> : null}
        {state.kind === "error" ? <ErrorState onRetry={reload} /> : null}

        {state.kind === "ready" && state.messages.length === 0 ? (
          <EmptyState title={t("messaging.thread.empty")} />
        ) : null}

        {state.kind === "ready" && state.messages.length > 0 ? (
          <div className="flex flex-col gap-3">
            {state.hasOlder ? (
              <div className="flex justify-center pb-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingOlder}
                  onClick={() => void handleLoadOlder()}
                >
                  {loadingOlder ? t("states.loading") : t("messaging.thread.loadOlder")}
                </Button>
              </div>
            ) : null}
            {state.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={currentUserId !== null && message.senderProfileId === currentUserId}
                {...(orderHref !== undefined ? { orderHref } : {})}
              />
            ))}
          </div>
        ) : null}
      </div>

      {status === "archived" ? (
        <p className="shrink-0 border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
          {t("messaging.thread.archived")}
        </p>
      ) : (
        <MessageComposer
          threadId={threadId}
          disabled={state.kind !== "ready"}
          onSend={send}
          onSent={() => {
            const container = containerRef.current;
            if (container !== null) container.scrollTop = container.scrollHeight;
          }}
        />
      )}
    </div>
  );
}
