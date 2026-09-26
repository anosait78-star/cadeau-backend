import { X } from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { OrderStatus } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";
import { ORDER_STATUS_TONE } from "./orders-status-tones";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * The phone's status-change strip, shown while orders are selected.
 *
 * It takes the place of the status *filter* strip rather than stacking above
 * it: the two are the same shape, and side by side there would be nothing to
 * say which one filters the list and which one changes the orders in it.
 *
 * The targets are the intersection of what every selected order may move to,
 * so a status can never be offered that only some of them could take — the
 * server would reject the rest one by one, with the user having no way to
 * tell which. When that intersection is empty the strip says so, rather than
 * leaving a row of nothing to explain itself.
 *
 * It scrolls sideways for the same reason the filter strip does: eleven
 * statuses do not fit a phone, and wrapping them into three rows pushes the
 * orders themselves off the screen.
 */
export function OrdersMobileStatusBar({
  selectedCount,
  targets,
  onPick,
  onClear,
  t,
}: {
  readonly selectedCount: number;
  readonly targets: readonly OrderStatus[];
  readonly onPick: (status: OrderStatus) => void;
  readonly onClear: () => void;
  readonly t: Translate;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-primary/30 bg-card p-2 shadow-xs">
      <div className="flex items-center justify-between gap-2 px-1.5">
        <span className="text-sm font-semibold text-foreground">
          {t("orders.mobile.selectedCount", { count: selectedCount })}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label={t("orders.bulk.clear")}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {t("orders.bulk.clear")}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {targets.length === 0 ? (
        <p className="px-1.5 pb-1 text-xs text-muted-foreground">
          {t("orders.mobile.noSharedStatus")}
        </p>
      ) : (
        <div
          className="flex flex-nowrap gap-1.5 overflow-x-auto hide-scrollbar"
          role="group"
          aria-label={t("orders.mobile.changeStatusTo")}
        >
          {targets.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => onPick(status)}
              className={cn(
                "shrink-0 rounded-xl border border-border bg-card px-2.5 py-2 transition-colors",
                "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <StatusBadge
                tone={ORDER_STATUS_TONE[status]}
                label={t(`orders.status.${status}` as TranslationKey)}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
