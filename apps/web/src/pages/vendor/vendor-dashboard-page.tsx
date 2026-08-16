import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { useMyVendorGroups } from "@/features/vendor/use-my-vendor-groups";
import type { VendorGroup, VendorGroupStatus } from "@/features/vendor/vendor-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "@/lib/format-money";
import { VendorLayout } from "./vendor-layout";

const RECENT_LIMIT = 5;

function itemsTotal(group: VendorGroup): number {
  return group.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/** Mirrors the company Dashboard's `KpiTile` (dashboard-page.tsx) — same shape, vendor-scoped data. */
function KpiTile({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums" dir="ltr">
        {value}
      </p>
    </div>
  );
}

/**
 * "حساب التاجر" — a real dashboard for the vendor (Vendor Accounts, Phase 7),
 * matching the Company Dashboard's UX/organization (KPI row + a recent-orders
 * card) but entirely vendor-scoped: every number here is computed client-side
 * from {@link useMyVendorGroups}, the same `GET /v1/vendor/order-groups` read
 * that is itself the server-side isolation boundary (Phase 3) — a vendor
 * literally cannot receive another vendor's group from this endpoint, so
 * there is nothing here to leak. No company-wide KPI (revenue, customers,
 * other vendors' orders, …) is ever fetched or shown.
 *
 * Status changes now live on the Order Detail screen (`/vendor/orders/:id`)
 * — this page is read-only, matching the Company Dashboard's own
 * RecentOrdersCard (click a row to act on it, don't act on it here).
 */
export function VendorDashboardPage(): ReactNode {
  const { t, locale } = useI18n();
  const { state, reload } = useMyVendorGroups();

  const counts = useMemo(() => {
    const base: Record<VendorGroupStatus | "total", number> = {
      total: 0,
      new: 0,
      processing: 0,
      ready: 0,
      delivered: 0,
    };
    if (state.kind !== "ready") return base;
    base.total = state.groups.length;
    for (const group of state.groups) base[group.status] += 1;
    return base;
  }, [state]);

  const recent = useMemo(() => {
    if (state.kind !== "ready") return [];
    return [...state.groups]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, RECENT_LIMIT);
  }, [state]);

  return (
    <VendorLayout>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("vendor.dashboard.overview.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("vendor.dashboard.subtitle")}</p>
      </header>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={reload} /> : null}

      {state.kind === "ready" && state.groups.length === 0 ? (
        <EmptyState title={t("vendor.dashboard.empty")} />
      ) : null}

      {state.kind === "ready" && state.groups.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiTile label={t("vendor.dashboard.kpi.total")} value={counts.total} />
            <KpiTile label={t("vendor.dashboard.kpi.new")} value={counts.new} />
            <KpiTile label={t("vendor.dashboard.kpi.processing")} value={counts.processing} />
            <KpiTile label={t("vendor.dashboard.kpi.ready")} value={counts.ready} />
            <KpiTile label={t("vendor.dashboard.kpi.delivered")} value={counts.delivered} />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">{t("vendor.dashboard.recent.title")}</CardTitle>
              <Link
                to="/vendor/orders"
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("vendor.dashboard.recent.viewAll")}
              </Link>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {recent.map((group) => (
                  <li key={group.id}>
                    <Link
                      to={`/vendor/orders/${group.id}`}
                      className="flex items-center gap-3 py-2.5 text-sm hover:bg-muted/50"
                    >
                      <ProductThumb imageUrl={group.items[0]?.imageUrl ?? null} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">
                          {t("vendor.dashboard.order")} #{group.orderNumber}
                        </span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {group.items.length} {t("orders.field.items")}
                        </span>
                      </span>
                      <StatusBadge
                        tone={VENDOR_GROUP_STATUS_TONE[group.status]}
                        label={t(`vendor.group.status.${group.status}` as TranslationKey)}
                      />
                      <span className="w-20 shrink-0 text-end tabular-nums" dir="ltr">
                        {formatMoney(itemsTotal(group), locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : null}
    </VendorLayout>
  );
}
