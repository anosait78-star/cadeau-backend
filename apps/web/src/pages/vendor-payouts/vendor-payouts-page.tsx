import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { FeatureGate } from "@/components/access/feature-gate";
import { PageTitle } from "@/components/layout/page-title";
import { useRegisterMobileRefresh } from "@/components/shell/mobile/mobile-header-context";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { Input } from "@/components/ui/input";
import { normalizeSearchText } from "@/features/inventory/warehouse-search";
import {
  listVendorBalances,
  type VendorBalance,
} from "@/features/vendor-payouts/vendor-payouts-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "@/lib/format-money";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly vendors: VendorBalance[] };

/**
 * "حسابات التجار" — every vendor with what the company owes them
 * (`vendor_payouts` feature + `vendor_payouts.read`, re-checked by the API).
 * A table on desktop, cards on a phone (ADR-002). Each vendor opens their own
 * page, where payouts are requested and settled.
 */
export function VendorPayoutsPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="vendor_payouts"
      fallback={
        <div className="mx-auto w-full max-w-5xl lg:p-6">
          <EmptyState title={t("vendorPayouts.forbidden")} />
        </div>
      }
    >
      <VendorPayoutsScreen />
    </FeatureGate>
  );
}

function VendorPayoutsScreen(): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [query, setQuery] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const { data } = await listVendorBalances();
      setState({ kind: "ready", vendors: data });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useRegisterMobileRefresh(() => load());
  useEffect(() => {
    void load();
  }, [load]);

  // Folds Arabic spelling variants (أ/إ/ا, ة/ه, ى/ي) like the warehouses search.
  const visible = useMemo(() => {
    if (state.kind !== "ready") return [];
    const needle = normalizeSearchText(query);
    if (needle.length === 0) return state.vendors;
    return state.vendors.filter((v) =>
      normalizeSearchText(`${v.warehouseName} ${v.vendorName ?? ""}`).includes(needle),
    );
  }, [state, query]);

  const totalOwed = visible.reduce((sum, v) => sum + v.owedMinor, 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 lg:p-6">
      <PageTitle
        title={t("vendorPayouts.list.title")}
        description={t("vendorPayouts.list.subtitle")}
      />

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind === "ready" && state.vendors.length === 0 ? (
        <EmptyState title={t("vendorPayouts.list.empty")} />
      ) : null}

      {state.kind === "ready" && state.vendors.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("vendorPayouts.list.search")}
              aria-label={t("vendorPayouts.list.search")}
              className="sm:max-w-sm"
            />
            <p className="text-sm text-muted-foreground">
              {t("vendorPayouts.list.totalOwed")}:{" "}
              <span className="font-semibold text-foreground tabular-nums" dir="ltr">
                {formatMoney(totalOwed, locale)}
              </span>
            </p>
          </div>

          {isDesktop ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 text-start font-medium">{t("vendorPayouts.list.vendor")}</th>
                  <th className="py-2 text-end font-medium">{t("vendorPayouts.balance.owed")}</th>
                  <th className="py-2 text-end font-medium">
                    {t("vendorPayouts.balance.pending")}
                  </th>
                  <th className="py-2 text-end font-medium">{t("vendorPayouts.balance.paid")}</th>
                  <th className="py-2 text-end font-medium">{t("vendorPayouts.list.flags")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((vendor) => (
                  <tr
                    key={vendor.warehouseId}
                    className="border-b border-border/60 hover:bg-muted/40"
                  >
                    <td className="py-2">
                      <Link
                        to={`/vendor-payouts/${vendor.warehouseId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {vendor.warehouseName}
                      </Link>
                      {vendor.vendorName === null ? null : (
                        <span className="block text-caption text-muted-foreground">
                          {vendor.vendorName}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-end font-semibold tabular-nums" dir="ltr">
                      {formatMoney(vendor.owedMinor, locale)}
                    </td>
                    <td className="py-2 text-end tabular-nums" dir="ltr">
                      {formatMoney(vendor.pendingMinor, locale)}
                    </td>
                    <td className="py-2 text-end tabular-nums" dir="ltr">
                      {formatMoney(vendor.paidMinor, locale)}
                    </td>
                    <td className="py-2 text-end">
                      <VendorFlags vendor={vendor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul className="flex flex-col gap-2">
              {visible.map((vendor) => (
                <li key={vendor.warehouseId}>
                  <Link
                    to={`/vendor-payouts/${vendor.warehouseId}`}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 active:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{vendor.warehouseName}</p>
                        {vendor.vendorName === null ? null : (
                          <p className="truncate text-caption text-muted-foreground">
                            {vendor.vendorName}
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 text-base font-semibold tabular-nums" dir="ltr">
                        {formatMoney(vendor.owedMinor, locale)}
                      </p>
                    </div>
                    <VendorFlags vendor={vendor} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Badges for what needs attention: a payout awaiting the vendor, lines awaiting a price. */
function VendorFlags({ vendor }: { vendor: VendorBalance }): ReactNode {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {vendor.pendingPayoutId === null ? null : (
        <StatusBadge tone="info" label={t("vendorPayouts.list.awaitingVendor")} />
      )}
      {vendor.needsPricingCount === 0 ? null : (
        <StatusBadge
          tone="destructive"
          label={t("vendorPayouts.list.needsPricing", { count: vendor.needsPricingCount })}
        />
      )}
    </span>
  );
}
