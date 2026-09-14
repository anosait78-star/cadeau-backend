import { Bell, BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notificationText } from "@/features/notifications/notification-content";
import {
  listNotifications,
  markNotificationsRead,
  type NotificationItem,
} from "@/features/notifications/notifications-api";
import { usePushPrompt } from "@/features/notifications/use-push-prompt";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/** How often to poll for unread notifications while the bell is mounted. */
const POLL_INTERVAL_MS = 30_000;
/** How many recent notifications the panel shows. */
const PANEL_LIMIT = 10;

type PanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: NotificationItem[] };

/**
 * The notification bell (EPIC-15 M15.4): an unread indicator + a dropdown
 * panel of the caller's most recent notifications, with mark-read. Shared by
 * both shells' top bars — the whole component renders nothing when the
 * `notifications` feature is off (checked by the caller via `<FeatureGate>`,
 * matching `GET /v1/notifications`'s feature-only gate, D1).
 *
 * There is no server-side unread *count* (keyset pagination never exposes a
 * total, api-conventions §5) — the indicator is a boolean "has unread",
 * checked with a cheap `read=false&limit=1` poll, not a number.
 */
export function NotificationBell(): ReactNode {
  const { t, locale } = useI18n();
  const push = usePushPrompt();
  const [hasUnread, setHasUnread] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ kind: "idle" });

  const checkUnread = useCallback(async (): Promise<void> => {
    try {
      const page = await listNotifications({ read: false, limit: 1 });
      setHasUnread(page.data.length > 0);
    } catch {
      // A transient failure to poll the indicator is not worth surfacing.
    }
  }, []);

  useEffect(() => {
    void checkUnread();
    const timer = setInterval(() => void checkUnread(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkUnread]);

  const loadPanel = useCallback(async (): Promise<void> => {
    setPanel({ kind: "loading" });
    try {
      const page = await listNotifications({ limit: PANEL_LIMIT });
      setPanel({ kind: "ready", items: [...page.data] });
    } catch {
      setPanel({ kind: "error" });
    }
  }, []);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) void loadPanel();
    },
    [loadPanel],
  );

  const markRead = useCallback(
    async (id: string): Promise<void> => {
      setPanel((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              items: current.items.map((item) =>
                item.id === id && item.readAt === null
                  ? { ...item, readAt: new Date().toISOString() }
                  : item,
              ),
            }
          : current,
      );
      try {
        await markNotificationsRead([id]);
      } catch {
        // Best-effort: the next open/poll reconciles state from the server.
      }
      void checkUnread();
    },
    [checkUnread],
  );

  const markAllRead = useCallback(async (): Promise<void> => {
    if (panel.kind !== "ready") return;
    const unreadIds = panel.items.filter((item) => item.readAt === null).map((item) => item.id);
    if (unreadIds.length === 0) return;
    setPanel({
      kind: "ready",
      items: panel.items.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    });
    try {
      await markNotificationsRead(unreadIds);
    } catch {
      // Best-effort: the next open/poll reconciles state from the server.
    }
    void checkUnread();
  }, [panel, checkUnread]);

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("notifications.bell.label")}>
          <span className="relative inline-flex">
            <Bell className="h-4 w-4" aria-hidden="true" />
            {hasUnread ? (
              <span
                className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
            ) : null}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">{t("notifications.title")}</span>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => void markAllRead()}
          >
            {t("notifications.markAllRead")}
          </button>
        </div>

        {push.shouldPrompt ? <PushNudge push={push} /> : null}

        {panel.kind === "loading" || panel.kind === "idle" ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            {t("states.loading")}
          </p>
        ) : null}
        {panel.kind === "error" ? (
          <p className="px-2 py-4 text-center text-sm text-destructive">
            {t("notifications.loadFailed")}
          </p>
        ) : null}
        {panel.kind === "ready" && panel.items.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            {t("notifications.empty.title")}
          </p>
        ) : null}

        {panel.kind === "ready" && panel.items.length > 0 ? (
          <ul className="max-h-80 overflow-y-auto">
            {panel.items.map((item) => {
              // Rendered from the row's type + payload so the reader sees their
              // own language; the stored title/body are only the fallback.
              const text = notificationText(item, t, locale);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void markRead(item.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-sm px-2 py-2 text-start hover:bg-muted",
                      item.readAt === null && "bg-primary/5",
                    )}
                  >
                    <span className="text-sm font-medium text-foreground">{text.title}</span>
                    <span className="text-xs text-muted-foreground">{text.body}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="border-t border-border px-2 py-1.5">
          <Link
            to="/settings/notifications"
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("notifications.preferences.link")}
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The banner inside the bell asking to turn push on, shown every time the
 * panel is opened while this device is unsubscribed — the bell is exactly
 * where someone is already thinking about notifications, so it is the one
 * place the ask is not an interruption.
 */
function PushNudge({ push }: { readonly push: ReturnType<typeof usePushPrompt> }): ReactNode {
  const { t } = useI18n();
  return (
    <div className="m-2 flex flex-col gap-2 rounded-lg bg-primary/5 p-2.5">
      <div className="flex items-start gap-2">
        <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {t("notifications.push.nudgeTitle")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("notifications.push.nudgeBody")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => void push.enable()}
          disabled={push.busy}
        >
          {t("notifications.push.enable")}
        </Button>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          onClick={push.dismiss}
        >
          {t("notifications.push.later")}
        </button>
      </div>
    </div>
  );
}
