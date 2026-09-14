import { BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { claimSessionPushPrompt, usePushPrompt } from "@/features/notifications/use-push-prompt";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * A one-per-sign-in invitation to turn push on, shown once the shell is up.
 *
 * It is a banner rather than the browser's own permission dialog: that dialog
 * only ever appears when the user presses "enable" here. Firing it
 * unprompted at sign-in is what gets an origin's permission revoked for good,
 * and a refusal there cannot be undone by us afterwards.
 *
 * It appears once per session, so each sign-in asks again while a single
 * working day is not nagged repeatedly. A device that cannot take push, or
 * whose owner has already refused, never sees it.
 */
export function PushSignInPrompt(): ReactNode {
  return (
    <FeatureGate feature="notifications">
      <PushSignInBanner />
    </FeatureGate>
  );
}

function PushSignInBanner(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const push = usePushPrompt();
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    // Only claim the session's single showing once we know push is actually
    // offerable, so a device that cannot take it does not burn the slot.
    if (push.state === "idle" && !claimed && claimPrompt()) setClaimed(true);
  }, [push.state, claimed]);

  if (!claimed || !push.shouldPrompt) return null;

  const handleEnable = async (): Promise<void> => {
    const next = await push.enable();
    if (next === "enabled") toast.show(t("notifications.push.enabled"));
    else if (next === "denied") toast.show(t("notifications.push.denied"), { variant: "error" });
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-primary/5 px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      >
        <BellRing className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {t("notifications.push.nudgeTitle")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("notifications.push.nudgeBody")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={() => void handleEnable()} disabled={push.busy}>
          {t("notifications.push.enable")}
        </Button>
        <button
          type="button"
          aria-label={t("notifications.push.later")}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={push.dismiss}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Split out so the effect above reads as one condition. */
function claimPrompt(): boolean {
  return claimSessionPushPrompt();
}
