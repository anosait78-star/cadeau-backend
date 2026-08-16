import type { ReactNode } from "react";
import type { Column } from "@/components/data-grid/types";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { VendorGroup } from "@/features/vendor/vendor-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import type { TranslationKey } from "@/i18n/dictionaries";
import type { Translate } from "@/components/i18n/translate-type";

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

export function vendorGroupTotal(group: VendorGroup): number {
  return group.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function OrderCell({ group, itemsLabel }: { group: VendorGroup; itemsLabel: string }): ReactNode {
  return (
    <div className="flex items-center gap-2.5">
      <ProductThumb imageUrl={group.items[0]?.imageUrl ?? null} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-foreground" dir="ltr">
          #{group.orderNumber}
        </span>
        <span className="block truncate text-caption text-muted-foreground">{itemsLabel}</span>
      </span>
    </div>
  );
}

/**
 * Vendor Orders' `Column<VendorGroup>[]` defs (Vendor Accounts, Phase 7) —
 * mirrors `orders-columns.tsx`'s shape/visual language. Every row is already
 * scoped to the caller's own warehouse by the API itself (Phase 3); this file
 * is purely presentational.
 */
export function buildVendorOrderColumns({
  t,
  locale,
}: {
  t: Translate;
  locale: string;
}): Column<VendorGroup>[] {
  return [
    {
      key: "order",
      header: t("orders.field.orderNumber"),
      render: (row) => (
        <OrderCell group={row} itemsLabel={`${row.items.length} ${t("orders.field.items")}`} />
      ),
      clientSortable: true,
      sortAccessor: (row) => row.orderNumber,
    },
    {
      key: "status",
      header: t("vendor.orderDetail.status.title"),
      render: (row) => (
        <StatusBadge
          tone={VENDOR_GROUP_STATUS_TONE[row.status]}
          label={t(`vendor.group.status.${row.status}` as TranslationKey)}
        />
      ),
    },
    {
      key: "total",
      header: t("orders.field.total"),
      render: (row) => (
        <span className="font-semibold text-foreground tabular-nums" dir="ltr">
          {formatMoney(vendorGroupTotal(row), locale)}
        </span>
      ),
      clientSortable: true,
      sortAccessor: (row) => vendorGroupTotal(row),
      align: "end",
    },
    {
      key: "updatedAt",
      header: t("vendor.dashboard.updatedAt"),
      render: (row) => (
        <span className="text-muted-foreground" dir="ltr">
          {formatDateTime(row.updatedAt, locale)}
        </span>
      ),
      clientSortable: true,
      sortAccessor: (row) => row.updatedAt,
    },
  ];
}
