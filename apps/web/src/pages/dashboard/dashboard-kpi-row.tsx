import { CalendarDays, Clock, Coins, ShoppingBag, Truck, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { KpiRow, type KpiTileSpec } from "@/components/kpi/kpi-card";
import { CardListSkeleton } from "@/components/states/skeleton";
import { ErrorState } from "@/components/states/error-state";
import {
  fetchPeriodKpis,
  KPI_PERIODS,
  type KpiPeriod,
  type PeriodKpis,
} from "@/features/analytics/period-kpis";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly kpis: PeriodKpis };

/**
 * The dashboard's headline figures, scoped to a period the user picks.
 *
 * Same card as the Orders list uses (`KpiRow`), different source: these come
 * from the analytics aggregates, which are computed server-side and carry their
 * own period-over-period deltas. That matters at this scale — the Orders page's
 * money KPIs sample a capped page of rows, which is fine for "today" and
 * meaningless for "this year".
 */
export function DashboardKpiRow(): ReactNode {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<KpiPeriod>("today");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void fetchPeriodKpis(period)
      .then((kpis) => {
        if (active) setState({ kind: "ready", kpis });
      })
      .catch(() => {
        if (active) setState({ kind: "error" });
      });
    return () => {
      active = false;
    };
  }, [period]);

  return (
    <section className="flex flex-col gap-3" aria-label={t("dashboard.kpi.title")}>
      <PeriodPicker period={period} onChange={setPeriod} />

      {state.kind === "loading" ? <CardListSkeleton rows={3} label={t("states.loading")} /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => setPeriod(period)} /> : null}
      {state.kind === "ready" ? (
        <KpiRow
          tiles={buildTiles(state.kpis, t, locale)}
          trendSuffix={t(`dashboard.kpi.vs.${period}` as TranslationKey)}
          testId="dashboard-kpi-row"
        />
      ) : null}
    </section>
  );
}

/**
 * The period control. A scrolling single line rather than a wrapping block: six
 * options wrap into three rows on a phone, which costs more height than the
 * cards they describe.
 */
function PeriodPicker({
  period,
  onChange,
}: {
  period: KpiPeriod;
  onChange: (next: KpiPeriod) => void;
}): ReactNode {
  const { t } = useI18n();

  return (
    <div
      role="tablist"
      aria-label={t("dashboard.kpi.period")}
      className={cn(
        "flex gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-xs",
        "flex-nowrap overflow-x-auto hide-scrollbar lg:flex-wrap lg:overflow-x-visible",
      )}
    >
      {KPI_PERIODS.map((key) => {
        const active = key === period;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={cn(
              "pressable inline-flex shrink-0 items-center rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(`dashboard.kpi.period.${key}` as TranslationKey)}
          </button>
        );
      })}
    </div>
  );
}

function buildTiles(
  kpis: PeriodKpis,
  t: (key: TranslationKey) => string,
  locale: string,
): KpiTileSpec[] {
  return [
    {
      label: t("dashboard.kpi.collected"),
      value: formatMoney(kpis.collectedMinor, locale),
      icon: <Wallet className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-success/10 text-success",
      trendPct: kpis.collectedTrendPct,
      series: kpis.collectedSeries.length > 1 ? kpis.collectedSeries : null,
    },
    {
      label: t("dashboard.kpi.orders"),
      value: String(kpis.orderCount),
      icon: <ShoppingBag className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-primary/10 text-primary",
      trendPct: kpis.orderCountTrendPct,
      series: kpis.orderSeries.length > 1 ? kpis.orderSeries : null,
    },
    {
      label: t("dashboard.kpi.averageOrder"),
      value: formatMoney(kpis.averageOrderValueMinor, locale),
      icon: <Coins className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-info/10 text-info",
      trendPct: null,
      series: null,
    },
    {
      label: t("dashboard.kpi.shipped"),
      value: String(kpis.shipped),
      icon: <Truck className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-info/10 text-info",
      trendPct: null,
      series: null,
    },
    {
      label: t("dashboard.kpi.processing"),
      value: String(kpis.processing),
      icon: <Clock className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-warning/10 text-warning",
      trendPct: null,
      series: null,
    },
    {
      label: t("dashboard.kpi.totalInPeriod"),
      value: String(kpis.totalInPeriod),
      icon: <CalendarDays className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-muted text-foreground",
      trendPct: null,
      series: null,
    },
  ];
}
