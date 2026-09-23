import type { ReactNode } from "react";
import { MobileListRow } from "@/components/data-grid/mobile-list-row";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageThread } from "./messaging-api";

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

/** Today shows a time; any other day shows a short date — same convention `orders-columns.tsx` uses. */
function lastMessageTime(iso: string, locale: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** One conversation row in the staff thread list (EPIC-17 M17.6). */
export function ThreadListRow({
  thread,
  onPress,
}: {
  readonly thread: MessageThread;
  readonly onPress: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const hasUnread = thread.unreadCount > 0;

  return (
    <MobileListRow
      onPress={onPress}
      leading={
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
          aria-hidden="true"
        >
          {initials(thread.warehouseName)}
        </span>
      }
      title={
        <span className="flex items-center gap-1.5">
          {hasUnread ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-destructive"
              aria-hidden="true"
              data-testid="thread-unread-dot"
            />
          ) : null}
          {thread.warehouseName}
        </span>
      }
      secondary={thread.lastMessagePreview ?? t("messaging.thread.noMessagesYet")}
      trailing={
        thread.lastMessageAt !== null ? (
          <span dir="ltr">{lastMessageTime(thread.lastMessageAt, locale)}</span>
        ) : undefined
      }
    />
  );
}
