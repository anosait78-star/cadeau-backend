import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { useToast } from "@/components/toast/toast";
import {
  advanceVendorGroupStatus,
  listMyVendorGroups,
  NEXT_VENDOR_GROUP_STATUS,
  type VendorGroup,
} from "@/features/vendor/vendor-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { VendorLayout } from "./vendor-layout";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly groups: VendorGroup[] };

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * "حساب التاجر" — the vendor's own, deliberately simple dashboard (Vendor
 * Accounts, Phase 4): the groups routed to their warehouse, across every
 * order, and a single button to advance each one exactly one step
 * (`new → processing → ready → delivered`). Reuses the existing
 * `/v1/vendor/order-groups` surface from Phase 3 as-is — no new API.
 */
export function VendorDashboardPage(): ReactNode {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const { data } = await listMyVendorGroups();
      setState({ kind: "ready", groups: data });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = async (group: VendorGroup): Promise<void> => {
    const next = NEXT_VENDOR_GROUP_STATUS[group.status];
    if (next === null) return;
    setAdvancingId(group.id);
    try {
      const updated = await advanceVendorGroupStatus(group.id, next);
      setState((prev) =>
        prev.kind === "ready"
          ? { kind: "ready", groups: prev.groups.map((g) => (g.id === updated.id ? updated : g)) }
          : prev,
      );
      toast.show(t("vendor.dashboard.saved"));
    } catch {
      toast.show(t("vendor.dashboard.saveFailed"));
    } finally {
      setAdvancingId(null);
    }
  };

  return (
    <VendorLayout>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("vendor.dashboard.myOrders")}</h1>
        <p className="text-sm text-muted-foreground">{t("vendor.dashboard.subtitle")}</p>
      </header>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
      {state.kind === "ready" && state.groups.length === 0 ? (
        <EmptyState title={t("vendor.dashboard.empty")} />
      ) : null}

      {state.kind === "ready"
        ? state.groups.map((group) => {
            const next = NEXT_VENDOR_GROUP_STATUS[group.status];
            return (
              <Card key={group.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>
                      {t("vendor.dashboard.order")} #{group.orderNumber}
                    </span>
                    <StatusBadge
                      tone={VENDOR_GROUP_STATUS_TONE[group.status]}
                      label={t(`vendor.group.status.${group.status}` as TranslationKey)}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <ul className="flex flex-col gap-1 text-sm">
                    {group.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-2">
                        <span>
                          {item.nameSnapshot} × {item.quantity}
                        </span>
                        <span dir="ltr">{formatMoney(item.price * item.quantity, locale)}</span>
                      </li>
                    ))}
                  </ul>
                  {next !== null ? (
                    <div>
                      <Button
                        size="sm"
                        disabled={advancingId === group.id}
                        onClick={() => void advance(group)}
                      >
                        {t(`vendor.dashboard.advanceTo.${next}` as TranslationKey)}
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        : null}
    </VendorLayout>
  );
}
