import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { useToast } from "@/components/toast/toast";
import { advanceVendorGroupStatus, type VendorGroupStatus } from "@/features/vendor/vendor-api";
import { useMyVendorGroups } from "@/features/vendor/use-my-vendor-groups";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { VendorOrderSummary } from "./vendor-order-summary";
import { VendorStatusActions } from "./vendor-status-actions";

/**
 * Vendor Order Detail (Vendor Accounts, Phase 7) — the vendor's own slice of
 * one order: their items only, their group's status, and the
 * `new → processing → ready → delivered` controls.
 *
 * Since the orders board gained its side panel, this is the **mobile** path
 * (and the target of any direct link on any device): desktop opens the same
 * body, `VendorOrderSummary`, inside `VendorOrderPanel` without leaving the
 * list. Both render the identical summary and the identical
 * `VendorStatusActions`, so the two can't drift.
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
  const [moving, setMoving] = useState(false);

  const group = useMemo(() => {
    if (state.kind !== "ready" || groupId === undefined) return null;
    return state.groups.find((g) => g.id === groupId) ?? null;
  }, [state, groupId]);

  const move = async (to: VendorGroupStatus): Promise<void> => {
    if (group === null) return;
    setMoving(true);
    try {
      patchGroup(await advanceVendorGroupStatus(group.id, to));
      toast.show(t("vendor.dashboard.saved"));
    } catch {
      toast.show(t("vendor.dashboard.saveFailed"));
    } finally {
      setMoving(false);
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

          <Card>
            <CardContent className="pt-5">
              <VendorOrderSummary group={group} t={t} locale={locale} />
            </CardContent>
          </Card>

          <VendorStatusActions
            status={group.status}
            disabled={moving}
            onMove={(to) => void move(to)}
            t={t}
          />
        </>
      ) : null}
    </div>
  );
}
