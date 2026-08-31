import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * A standing notice while the device is offline.
 *
 * An installed app still opens without a network — the shell is cached — so the
 * user can reach screens whose data will not load. This says why, rather than
 * leaving them with a screen of failed requests. It is a persistent bar, not a
 * toast: the condition lasts, so the message has to as well.
 */
export function OfflineBanner(): ReactNode {
  const { t } = useI18n();
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-caption text-warning-foreground"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{t("states.offline")}</span>
    </div>
  );
}
