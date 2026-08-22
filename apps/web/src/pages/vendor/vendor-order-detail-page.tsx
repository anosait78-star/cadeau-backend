import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { useToast } from "@/components/toast/toast";
import { advanceVendorGroupStatus, NEXT_VENDOR_GROUP_STATUS } from "@/features/vendor/vendor-api";
import { useMyVendorGroups } from "@/features/vendor/use-my-vendor-groups";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "@/lib/format-money";
import { vendorGroupTotal } from "./vendor-orders-columns";

function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Vendor Order Detail (Vendor Accounts, Phase 7) — the vendor's own slice of
 * one order: their items only, their group's status, and the same
 * `new → processing → ready → delivered` advance control the dashboard used
 * to carry (moved here to match the Company Order Detail's own
 * summary-then-act layout).
 *
 * No dedicated "get one vendor group" endpoint exists or is needed: this
 * reuses the same `GET /v1/vendor/order-groups` list every other vendor
 * screen already fetches (via {@link useMyVendorGroups}) and finds `groupId`
 * within it. Since that list is already scoped server-side to the caller's
 * own warehouse (Phase 3), a `groupId` belonging to another vendor — however
 * it got into the URL — simply never appears in the results: this renders
 * the same "not found" state as a `groupId` that never existed at all, never
 * another vendor's data.
 */
export function VendorOrderDetailPage(): ReactNode {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { groupId } = useParams<{ groupId: string }>();
  const { state, reload, patchGroup } = useMyVendorGroups();
  const [advancing, setAdvancing] = useState(false);

  const group = useMemo(() => {
    if (state.kind !== "ready" || groupId === undefined) return null;
    return state.groups.find((g) => g.id === groupId) ?? null;
  }, [state, groupId]);

  const advance = async (): Promise<void> => {
    if (group === null) return;
    const next = NEXT_VENDOR_GROUP_STATUS[group.status];
    if (next === null) return;
    setAdvancing(true);
    try {
      const updated = await advanceVendorGroupStatus(group.id, next);
      patchGroup(updated);
      toast.show(t("vendor.dashboard.saved"));
    } catch {
      toast.show(t("vendor.dashboard.saveFailed"));
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to="/vendor/orders"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          {t("vendor.orderDetail.back")}
        </Link>
      </div>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={reload} /> : null}

      {state.kind === "ready" && group === null ? (
        <EmptyState
          title={t("vendor.orderDetail.notFound.title")}
          description={t("vendor.orderDetail.notFound.description")}
        />
      ) : null}

      {group !== null ? (
        <>
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold" dir="ltr">
              {t("vendor.dashboard.order")} #{group.orderNumber}
            </h1>
            <StatusBadge
              tone={VENDOR_GROUP_STATUS_TONE[group.status]}
              label={t(`vendor.group.status.${group.status}` as TranslationKey)}
            />
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">
                {t("vendor.orderDetail.field.warehouse")}
              </p>
              <p className="text-sm font-medium">{group.warehouseName}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3" dir="ltr">
              <p className="text-xs text-muted-foreground">{t("vendor.dashboard.updatedAt")}</p>
              <p className="text-sm font-medium">{formatDateTime(group.updatedAt, locale)}</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("vendor.orderDetail.items.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
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
            </CardContent>
          </Card>

          {NEXT_VENDOR_GROUP_STATUS[group.status] !== null ? (
            <div>
              <Button disabled={advancing} onClick={() => void advance()}>
                {t(
                  `vendor.dashboard.advanceTo.${NEXT_VENDOR_GROUP_STATUS[group.status]}` as TranslationKey,
                )}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
