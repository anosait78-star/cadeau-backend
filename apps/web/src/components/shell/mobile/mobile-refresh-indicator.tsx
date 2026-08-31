import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/**
 * The disc that follows a pull-to-refresh gesture down from under the header.
 *
 * It rotates with the pull and fills in once the gesture is armed, so the user
 * can see they have pulled far enough before letting go — the feedback that
 * makes the gesture discoverable without any instructions.
 */
export function MobileRefreshIndicator({
  distance,
  armed,
  refreshing,
}: {
  distance: number;
  armed: boolean;
  refreshing: boolean;
}): ReactNode {
  const { t } = useI18n();
  if (distance === 0 && !refreshing) return null;

  const offset = refreshing ? 48 : distance;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
      style={{ transform: `translateY(${offset - 40}px)` }}
      role="status"
      aria-label={refreshing ? t("states.loading") : undefined}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md",
          armed || refreshing ? "text-primary" : "text-muted-foreground",
        )}
      >
        <RefreshCw
          className={cn("h-4 w-4", refreshing && "animate-spin motion-reduce:animate-none")}
          style={refreshing ? undefined : { transform: `rotate(${distance * 3}deg)` }}
          aria-hidden="true"
        />
      </span>
    </div>
  );
}
