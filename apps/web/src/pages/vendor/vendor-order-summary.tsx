import type { ReactNode } from "react";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import type { VendorGroup } from "@/features/vendor/vendor-api";
import type { Translate } from "@/components/i18n/translate-type";
import { formatMoney } from "@/lib/format-money";
import { vendorGroupTotal } from "./vendor-orders-columns";

export function formatVendorDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * One vendor group's read-only body: warehouse, last change, the items with
 * their images, and the total. Shared verbatim by the desktop order panel and
 * the full-page mobile order detail so the two can never drift apart — only
 * the chrome around it differs.
 */
export function VendorOrderSummary({
  group,
  t,
  locale,
}: {
  readonly group: VendorGroup;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t("vendor.orderDetail.field.warehouse")}</p>
          <p className="text-sm font-medium">{group.warehouseName}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3" dir="ltr">
          <p className="text-xs text-muted-foreground">{t("vendor.dashboard.updatedAt")}</p>
          <p className="text-sm font-medium">{formatVendorDateTime(group.updatedAt, locale)}</p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("vendor.orderDetail.items.title")}</h3>
        <ul className="flex flex-col divide-y divide-border">
          {group.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
              <ProductThumb imageUrl={item.imageUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {item.nameSnapshot}
                </span>
                <span className="block text-caption text-muted-foreground" dir="ltr">
                  × {item.quantity}
                </span>
              </span>
              <span className="shrink-0 tabular-nums" dir="ltr">
                {formatMoney(item.price * item.quantity, locale)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
          <span>{t("orders.field.total")}</span>
          <span dir="ltr">{formatMoney(vendorGroupTotal(group), locale)}</span>
        </div>
      </div>
    </div>
  );
}
