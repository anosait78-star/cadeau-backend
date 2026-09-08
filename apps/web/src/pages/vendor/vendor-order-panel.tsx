import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { SideSheet } from "@/components/ui/side-sheet";
import type { VendorGroup, VendorGroupStatus } from "@/features/vendor/vendor-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import type { Translate } from "@/components/i18n/translate-type";
import type { TranslationKey } from "@/i18n/dictionaries";
import { VendorOrderSummary } from "./vendor-order-summary";
import { VendorStatusActions } from "./vendor-status-actions";

/**
 * The desktop order panel: clicking an order on the vendor's orders board
 * opens its details beside the list instead of navigating away, so the board
 * — and the drag-to-status affordance that lives on it — stays on screen.
 *
 * Mobile deliberately keeps the full-page `/vendor/orders/:groupId` route: a
 * side panel on a phone is just a worse full page, and that route also stays
 * the target of any direct link.
 *
 * The status control sits in a pinned footer rather than at the end of the
 * scrolling content, so it is reachable without scrolling past a long order.
 */
export function VendorOrderPanel({
  group,
  open,
  onOpenChange,
  onMove,
  busy = false,
  t,
  locale,
}: {
  readonly group: VendorGroup | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onMove: (group: VendorGroup, to: VendorGroupStatus) => void;
  readonly busy?: boolean;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  if (group === null) return null;

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${t("vendor.dashboard.order")} #${group.orderNumber}`}
      titleBadge={
        <StatusBadge
          tone={VENDOR_GROUP_STATUS_TONE[group.status]}
          label={t(`vendor.group.status.${group.status}` as TranslationKey)}
        />
      }
      subtitle={group.warehouseName}
      closeLabel={t("vendor.orders.panelClose")}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        <VendorOrderSummary group={group} t={t} locale={locale} />
      </div>

      <div className="shrink-0 border-t border-border bg-card px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t("vendor.orderDetail.status.title")}
            </span>
            <StatusBadge
              tone={VENDOR_GROUP_STATUS_TONE[group.status]}
              label={t(`vendor.group.status.${group.status}` as TranslationKey)}
            />
          </div>
          <VendorStatusActions
            status={group.status}
            disabled={busy}
            onMove={(to) => onMove(group, to)}
            t={t}
          />
        </div>
      </div>
    </SideSheet>
  );
}
