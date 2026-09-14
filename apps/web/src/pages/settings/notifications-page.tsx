import { BellRing, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/layout/page-title";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreference,
} from "@/features/notifications/notifications-api";
import {
  disablePush,
  enablePush,
  getPushState,
  type PushState,
} from "@/features/notifications/push";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly preferences: NotificationPreference[] };

/** The type label key for each notification type (matches the backend whitelist). */
function typeLabelKey(type: NotificationPreference["type"]): TranslationKey {
  return `notifications.type.${type}` as TranslationKey;
}

/**
 * Notification preferences (EPIC-15 M15.4): per-type, per-channel on/off
 * switches (`GET`/`PUT /v1/notifications/preferences`). Gated by the
 * `notifications` feature only, no permission — every user manages their own
 * settings regardless of role (decision D1).
 */
export function NotificationsPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="notifications"
      fallback={
        <div className="mx-auto w-full max-w-2xl lg:p-6">
          <EmptyState title={t("notifications.title")} />
        </div>
      }
    >
      <NotificationsPreferencesScreen />
    </FeatureGate>
  );
}

function NotificationsPreferencesScreen(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const { data } = await getNotificationPreferences();
      setState({ kind: "ready", preferences: [...data] });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (
    type: NotificationPreference["type"],
    channel: "inAppEnabled" | "webPushEnabled",
  ) => {
    setState((current) =>
      current.kind === "ready"
        ? {
            kind: "ready",
            preferences: current.preferences.map((p) =>
              p.type === type ? { ...p, [channel]: !p[channel] } : p,
            ),
          }
        : current,
    );
  };

  const save = async (): Promise<void> => {
    if (state.kind !== "ready") return;
    setSaving(true);
    try {
      const { data } = await updateNotificationPreferences(state.preferences);
      setState({ kind: "ready", preferences: [...data] });
      toast.show(t("notifications.preferences.saved"));
    } catch {
      toast.show(t("notifications.preferences.saveFailed"), { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 lg:p-6">
      <PageTitle
        title={t("notifications.preferences.title")}
        description={t("notifications.preferences.subtitle")}
      />

      <PushDeviceCard />

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind === "ready" ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("notifications.preferences.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {state.preferences.map((preference) => (
              <div
                key={preference.type}
                className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <span className="text-sm font-medium text-foreground">
                  {t(typeLabelKey(preference.type))}
                </span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={preference.inAppEnabled}
                      onChange={() => toggle(preference.type, "inAppEnabled")}
                    />
                    {t("notifications.preferences.inApp")}
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={preference.webPushEnabled}
                      onChange={() => toggle(preference.type, "webPushEnabled")}
                    />
                    {t("notifications.preferences.webPush")}
                  </label>
                </div>
              </div>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={() => void save()} disabled={saving}>
                {t("notifications.preferences.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Web Push for the device in front of the user.
 *
 * Push is per-device, not per-account: the per-type switches below decide
 * *what* is worth pushing, this decides whether *this* phone or laptop is
 * somewhere to push it. A browser that cannot do push at all, or a user who
 * has refused permission, is told so plainly — neither is something a button
 * can fix, and on iOS the answer is to install the app to the Home Screen
 * first, which is why that case says so.
 */
function PushDeviceCard(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPushState().then((next) => {
      if (!cancelled) setPushState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = pushState === "enabled" ? await disablePush() : await enablePush();
      setPushState(next);
      if (next === "enabled") toast.show(t("notifications.push.enabled"));
      else if (next === "denied") toast.show(t("notifications.push.denied"), { variant: "error" });
      else toast.show(t("notifications.push.disabled"));
    } catch {
      toast.show(t("notifications.push.failed"), { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (pushState === null) return null;

  const enabled = pushState === "enabled";
  const blocked = pushState === "unsupported" || pushState === "denied";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("notifications.push.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {enabled ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          </span>
          <p className="min-w-0 text-sm text-muted-foreground">
            {pushState === "unsupported"
              ? t("notifications.push.unsupported")
              : pushState === "denied"
                ? t("notifications.push.blocked")
                : enabled
                  ? t("notifications.push.onHint")
                  : t("notifications.push.offHint")}
          </p>
        </div>
        {blocked ? null : (
          <Button
            variant={enabled ? "outline" : "primary"}
            onClick={() => void toggle()}
            disabled={busy}
          >
            {enabled ? t("notifications.push.disable") : t("notifications.push.enable")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
