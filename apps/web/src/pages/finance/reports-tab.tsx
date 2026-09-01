import { useState } from "react";
import type { ReactNode } from "react";
import { FilterBar } from "@/components/filter-bar/filter-bar";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  getCashCenterReport,
  getPnlReport,
  type CashCenterReport,
  type PnlReport,
} from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { Field, formatMoney } from "./finance-shared";

type ReportState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly cashCenter: CashCenterReport; readonly pnl: PnlReport };

function defaultFrom(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cash center + P&L — a computed, read-only numeric summary over a date range (D6).
 * Audited 2026-08-02 for EPIC-16 Phase B shared-infra compliance: no DataGrid/ConfirmDialog/
 * StatusBadge/DetailPanel applicable (no record list, no destructive actions, no status chips).
 * Added shared LoadingState/ErrorState for the load cycle to match list-tab conventions.
 */
export function ReportsTab({ onNotify }: { onNotify: (text: string) => void }): ReactNode {
  const { t, locale } = useI18n();
  const [dateFrom, setDateFrom] = useState(defaultFrom());
  const [dateTo, setDateTo] = useState(defaultTo());
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [state, setState] = useState<ReportState>({ kind: "idle" });

  const load = async (): Promise<void> => {
    setState({ kind: "loading" });
    const range = {
      dateFrom: new Date(dateFrom).toISOString(),
      dateTo: new Date(dateTo).toISOString(),
      ...(compareFrom.length > 0 && compareTo.length > 0
        ? {
            compareFrom: new Date(compareFrom).toISOString(),
            compareTo: new Date(compareTo).toISOString(),
          }
        : {}),
    };
    try {
      const [cashCenter, pnl] = await Promise.all([
        getCashCenterReport(range),
        getPnlReport(range),
      ]);
      setState({ kind: "ready", cashCenter, pnl });
    } catch {
      setState({ kind: "error" });
      onNotify(t("finance.saveFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Four date pickers stacked ahead of the report is most of a phone
          screen, so below the desktop breakpoint they fold into a sheet — while
          "Load", which runs the report rather than narrowing it, stays out. */}
      <FilterBar
        activeCount={(compareFrom.length > 0 ? 1 : 0) + (compareTo.length > 0 ? 1 : 0)}
        actions={<Button onClick={() => void load()}>{t("finance.reports.actions.load")}</Button>}
      >
        <Field id="report-from" label={t("finance.reports.dateFrom")}>
          <DatePicker
            id="report-from"
            value={dateFrom.length > 0 ? dateFrom : null}
            onChange={(next) => setDateFrom(next ?? "")}
            ariaLabel={t("finance.reports.dateFrom")}
          />
        </Field>
        <Field id="report-to" label={t("finance.reports.dateTo")}>
          <DatePicker
            id="report-to"
            value={dateTo.length > 0 ? dateTo : null}
            onChange={(next) => setDateTo(next ?? "")}
            ariaLabel={t("finance.reports.dateTo")}
          />
        </Field>
        <Field id="report-compare-from" label={t("finance.reports.compareFrom")}>
          <DatePicker
            id="report-compare-from"
            value={compareFrom.length > 0 ? compareFrom : null}
            onChange={(next) => setCompareFrom(next ?? "")}
            ariaLabel={t("finance.reports.compareFrom")}
          />
        </Field>
        <Field id="report-compare-to" label={t("finance.reports.compareTo")}>
          <DatePicker
            id="report-compare-to"
            value={compareTo.length > 0 ? compareTo : null}
            onChange={(next) => setCompareTo(next ?? "")}
            ariaLabel={t("finance.reports.compareTo")}
          />
        </Field>
      </FilterBar>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind === "ready" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("finance.reports.cashCenter.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Stat
                  label={t("finance.reports.cashCenter.collected")}
                  value={state.cashCenter.collectedMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.cashCenter.expenses")}
                  value={state.cashCenter.expensesMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.cashCenter.poPayments")}
                  value={state.cashCenter.purchaseOrderPaymentsMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.cashCenter.refunds")}
                  value={state.cashCenter.refundsMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.cashCenter.shippingFees")}
                  value={state.cashCenter.shippingFeesMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.cashCenter.net")}
                  value={state.cashCenter.netCashMinor}
                  locale={locale}
                  emphasize
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("finance.reports.pnl.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Stat
                  label={t("finance.reports.pnl.revenue")}
                  value={state.pnl.current.revenueMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.pnl.cogs")}
                  value={state.pnl.current.cogsMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.pnl.expenses")}
                  value={state.pnl.current.expensesMinor}
                  locale={locale}
                />
                <Stat
                  label={t("finance.reports.pnl.netIncome")}
                  value={state.pnl.current.netIncomeMinor}
                  locale={locale}
                  emphasize
                />
              </dl>
              {state.pnl.previous !== undefined ? (
                <div>
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                    {t("finance.reports.pnl.previous")}
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <Stat
                      label={t("finance.reports.pnl.revenue")}
                      value={state.pnl.previous.revenueMinor}
                      locale={locale}
                    />
                    <Stat
                      label={t("finance.reports.pnl.netIncome")}
                      value={state.pnl.previous.netIncomeMinor}
                      locale={locale}
                    />
                  </dl>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  locale,
  emphasize = false,
}: {
  label: string;
  value: number;
  locale: string;
  emphasize?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${emphasize ? "text-base font-semibold" : ""}`}>
        {formatMoney(value, locale)}
      </dd>
    </div>
  );
}
