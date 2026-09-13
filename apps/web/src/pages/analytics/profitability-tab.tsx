import {
  ArrowDownToLine,
  Coins,
  Percent,
  PieChart,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { StatCard, StatCardSkeleton } from "@/components/ui/stat-card";
import {
  getProfitabilityAnalytics,
  type AnalyticsWindow,
  type ProfitabilityPoint,
  type ProfitabilitySummary,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { DASH, formatMoney, growthPill, MoneyValue, PanelCard } from "./analytics-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: ProfitabilitySummary };

/** Percent change from `previous` to `current`; `null` when there was no baseline. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Net income as a share of what was collected; `null` when nothing was. */
function marginPct(collectedMinor: number, netIncomeMinor: number): number | null {
  return collectedMinor === 0 ? null : (netIncomeMinor / collectedMinor) * 100;
}

/** Whole months the window spans, never less than one, for the monthly averages. */
function monthsInWindow(win: AnalyticsWindow): number {
  if (win.from === undefined || win.to === undefined) return 1;
  const days = (Date.parse(win.to) - Date.parse(win.from)) / 86_400_000;
  return Math.max(1, days / 30.44);
}

/**
 * Profitability for the picked window (`GET /v1/analytics/profitability`):
 * net income on collected − COGS − expenses (D4), the same figures split by
 * the toolbar's granularity as a chart, and how the money divides.
 */
export function ProfitabilityTab({ window: win }: { readonly window: AnalyticsWindow }): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const summary = await getProfitabilityAnalytics(win);
        if (!cancelled) setState({ kind: "ready", summary });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [win]);

  if (state.kind === "error") {
    return <p className="text-sm text-muted-foreground">{t("analytics.loadFailed")}</p>;
  }

  const summary = state.kind === "ready" ? state.summary : null;

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <ProfitStats summary={summary} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <TrendPanel summary={summary} className="lg:col-span-2" />
        <SplitPanel summary={summary} />
      </div>
      <IndicatorsPanel summary={summary} months={monthsInWindow(win)} />
    </div>
  );
}

/** The four headline figures, each against the preceding window of equal length. */
function ProfitStats({ summary }: { readonly summary: ProfitabilitySummary | null }): ReactNode {
  const { t, locale } = useI18n();
  const unit = t("analytics.currency");

  if (summary === null) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  const { current, previous } = summary;
  const vsPrevious = t("analytics.vsPrevious");
  const margin = marginPct(current.collectedMinor, current.netIncomeMinor);
  const previousMargin = marginPct(previous.collectedMinor, previous.netIncomeMinor);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatCard
        tone={current.netIncomeMinor < 0 ? "destructive" : "success"}
        icon={Coins}
        label={t("analytics.profitability.netIncome")}
        value={<MoneyValue minor={current.netIncomeMinor} locale={locale} unit={unit} />}
        pill={growthPill(percentChange(current.netIncomeMinor, previous.netIncomeMinor), locale)}
        hint={vsPrevious}
      />
      <StatCard
        tone="info"
        icon={ShoppingCart}
        label={t("analytics.profitability.sales")}
        value={<MoneyValue minor={current.collectedMinor} locale={locale} unit={unit} />}
        pill={growthPill(percentChange(current.collectedMinor, previous.collectedMinor), locale)}
        hint={vsPrevious}
      />
      <StatCard
        tone="primary"
        icon={Wallet}
        label={t("analytics.profitability.expenses")}
        value={<MoneyValue minor={current.expensesMinor} locale={locale} unit={unit} />}
        /* Spending: a rise is bad news, so the tone is flipped against growth. */
        pill={(() => {
          const pill = growthPill(
            percentChange(current.expensesMinor, previous.expensesMinor),
            locale,
          );
          if (pill === null || pill.tone === "neutral") return pill;
          return { ...pill, tone: pill.tone === "positive" ? "negative" : "positive" } as const;
        })()}
        hint={vsPrevious}
      />
      <StatCard
        tone="success"
        icon={PieChart}
        label={t("analytics.profitability.margin")}
        value={
          margin === null ? DASH : `${margin.toLocaleString(locale, { maximumFractionDigits: 2 })}%`
        }
        pill={
          margin === null || previousMargin === null
            ? null
            : growthPill(margin - previousMargin, locale)
        }
        hint={vsPrevious}
      />
    </div>
  );
}

/** Round up to 1, 2, 2.5 or 5 × a power of ten, so the axis steps read cleanly. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

function bucketLabel(iso: string, granularity: string, locale: string): string {
  const date = new Date(iso);
  if (granularity === "month") {
    return date.toLocaleString(locale, { month: "short", timeZone: "UTC" });
  }
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Sales and expenses as bars with net income as a line over them, bucketed by
 * the toolbar's granularity. Plain SVG and markup, like the finance charts —
 * the app carries no charting library.
 *
 * The axis is signed, so a loss draws below the zero line rather than being
 * clipped away. On a phone the plot keeps a readable bucket width and scrolls
 * sideways; a screen reader gets the same figures as a list.
 */
function TrendPanel({
  summary,
  className,
}: {
  readonly summary: ProfitabilitySummary | null;
  readonly className?: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <PanelCard
      className={className}
      title={t("analytics.profitability.chart.title")}
      hint={t("analytics.profitability.chart.hint")}
    >
      {summary === null ? (
        <div className="h-56 animate-pulse rounded-xl bg-muted lg:h-64" aria-busy="true" />
      ) : summary.series.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("analytics.profitability.chart.empty")}
        </p>
      ) : (
        <TrendChart series={summary.series} granularity={summary.granularity} />
      )}
    </PanelCard>
  );
}

function TrendChart({
  series,
  granularity,
}: {
  readonly series: readonly ProfitabilityPoint[];
  readonly granularity: string;
}): ReactNode {
  const { t, locale } = useI18n();

  /*
   * One scale for all three measures so the line and the bars can be read
   * against each other. It runs from the deepest loss to the tallest bar,
   * rounded out to clean steps, and always includes zero.
   */
  const values = series.flatMap((point) => [
    point.collectedMinor / 100,
    point.expensesMinor / 100,
    point.netIncomeMinor / 100,
  ]);
  const max = niceCeil(Math.max(0, ...values));
  const min = -niceCeil(Math.max(0, ...values.map((value) => -value)));
  const span = max - min || 1;
  /** A value's distance from the top of the plot, as a percentage. */
  const top = (value: number): number => ((max - value) / span) * 100;
  const zero = top(0);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => max - fraction * span);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });

  const stepPct = 100 / series.length;
  const linePoints = series
    .map((point, index) => `${(index + 0.5) * stepPct},${top(point.netIncomeMinor / 100)}`)
    .join(" ");

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div dir="ltr" aria-hidden="true" className="min-w-[520px] pt-2">
          <div className="flex h-52 lg:h-64">
            <div className="relative w-12 shrink-0 text-[10px] tabular-nums text-muted-foreground lg:text-xs">
              {ticks.map((value) => (
                <span
                  key={value}
                  className="absolute end-2 -translate-y-1/2 leading-none"
                  style={{ top: `${top(value)}%` }}
                >
                  {compact.format(value)}
                </span>
              ))}
            </div>
            <div className="relative flex-1">
              {ticks.map((value) => (
                <div
                  key={value}
                  className={cn(
                    "absolute inset-x-0 border-t",
                    value === 0 ? "border-border" : "border-dashed border-border/70",
                  )}
                  style={{ top: `${top(value)}%` }}
                />
              ))}
              <div className="absolute inset-0 flex">
                {series.map((point) => (
                  <Bucket key={point.bucket} point={point} top={top} zero={zero} locale={locale} />
                ))}
              </div>
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-primary"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polyline
                  points={linePoints}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          </div>
          <div className="mt-2 flex">
            <div className="w-12 shrink-0" />
            <div className="flex flex-1">
              {series.map((point) => (
                <span
                  key={point.bucket}
                  className="flex-1 truncate px-0.5 text-center text-[10px] text-muted-foreground lg:text-xs"
                >
                  {bucketLabel(point.bucket, granularity, locale)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <LegendKey className="bg-success" label={t("analytics.profitability.sales")} />
        <LegendKey className="bg-destructive" label={t("analytics.profitability.expenses")} />
        <LegendKey className="bg-primary" label={t("analytics.profitability.netIncome")} line />
      </div>

      <ul className="sr-only">
        {series.map((point) => (
          <li key={point.bucket}>
            {bucketLabel(point.bucket, granularity, locale)}: {t("analytics.profitability.sales")}{" "}
            {formatMoney(point.collectedMinor, locale)}, {t("analytics.profitability.expenses")}{" "}
            {formatMoney(point.expensesMinor, locale)}, {t("analytics.profitability.netIncome")}{" "}
            {formatMoney(point.netIncomeMinor, locale)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** One period's pair of bars, each growing away from the zero line. */
function Bucket({
  point,
  top,
  zero,
  locale,
}: {
  readonly point: ProfitabilityPoint;
  readonly top: (value: number) => number;
  readonly zero: number;
  readonly locale: string;
}): ReactNode {
  const { t } = useI18n();
  const bars = [
    {
      key: "sales",
      minor: point.collectedMinor,
      className: "bg-success/80",
      label: t("analytics.profitability.sales"),
    },
    {
      key: "expenses",
      minor: point.expensesMinor,
      className: "bg-destructive/80",
      label: t("analytics.profitability.expenses"),
    },
  ];

  return (
    <div className="relative flex flex-1 justify-center gap-1 px-1">
      {bars.map((bar) => {
        const end = top(bar.minor / 100);
        const height = Math.abs(zero - end);
        return (
          <div
            key={bar.key}
            className={cn("absolute w-[22%] max-w-[26px] rounded-sm", bar.className)}
            style={
              bar.minor >= 0
                ? { top: `${end}%`, height: `${height}%` }
                : { top: `${zero}%`, height: `${height}%` }
            }
            title={`${bar.label}: ${formatMoney(bar.minor, locale)}`}
          />
        );
      })}
    </div>
  );
}

function LegendKey({
  className,
  label,
  line = false,
}: {
  readonly className: string;
  readonly label: string;
  readonly line?: boolean;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(line ? "h-0.5 w-4 rounded-full" : "h-2.5 w-2.5 rounded-sm", className)}
      />
      {label}
    </span>
  );
}

/** How the window's money divides between what came in and what went out. */
function SplitPanel({ summary }: { readonly summary: ProfitabilitySummary | null }): ReactNode {
  const { t, locale } = useI18n();
  const unit = t("analytics.currency");

  if (summary === null) {
    return (
      <PanelCard title={t("analytics.profitability.split.title")}>
        <div className="h-56 animate-pulse rounded-xl bg-muted lg:h-64" aria-busy="true" />
      </PanelCard>
    );
  }

  const slices = [
    {
      key: "expenses",
      label: t("analytics.profitability.expenses"),
      minor: summary.current.expensesMinor,
      color: "var(--destructive)",
    },
    {
      key: "sales",
      label: t("analytics.profitability.sales"),
      minor: summary.current.collectedMinor,
      color: "var(--success)",
    },
  ];
  const total = slices.reduce((sum, slice) => sum + slice.minor, 0);

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const segments = slices.reduce<{ key: string; color: string; length: number; offset: number }[]>(
    (acc, slice) => {
      const previous = acc[acc.length - 1];
      const offset = previous === undefined ? 0 : previous.offset + previous.length;
      const length = total > 0 ? (slice.minor / total) * circumference : 0;
      return [...acc, { key: slice.key, color: slice.color, length, offset }];
    },
    [],
  );

  return (
    <PanelCard title={t("analytics.profitability.split.title")}>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6 lg:flex-col">
        <div className="relative h-40 w-40 shrink-0 lg:h-44 lg:w-44">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              strokeWidth="12"
              style={{ stroke: "var(--muted)" }}
            />
            {segments.map((segment) => (
              <circle
                key={segment.key}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                strokeWidth="12"
                strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                strokeDashoffset={-segment.offset}
                style={{ stroke: segment.color }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <span className="text-base font-bold tabular-nums leading-tight text-foreground lg:text-lg">
              {formatMoney(total, locale)}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">{unit}</span>
            <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
              {t("analytics.profitability.split.total")}
            </span>
          </div>
        </div>
        <ul className="flex w-full min-w-0 flex-1 flex-col divide-y divide-border">
          {slices.map((slice) => {
            const share = total > 0 ? (slice.minor / total) * 100 : 0;
            return (
              <li
                key={slice.key}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{slice.label}</p>
                    <p className="truncate text-xs tabular-nums text-muted-foreground">
                      {formatMoney(slice.minor, locale)} {unit}
                    </p>
                  </div>
                </div>
                <span
                  dir="ltr"
                  className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground"
                >
                  {`${Math.round(share)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </PanelCard>
  );
}

/**
 * Four derived readings the headline cards do not carry: the monthly run
 * rates, the margin, and the sales it would take to cover the window's
 * expenses once the goods themselves are paid for.
 */
function IndicatorsPanel({
  summary,
  months,
}: {
  readonly summary: ProfitabilitySummary | null;
  readonly months: number;
}): ReactNode {
  const { t, locale } = useI18n();
  const unit = t("analytics.currency");

  if (summary === null) {
    return (
      <PanelCard title={t("analytics.profitability.indicators.title")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-busy="true">
          {[0, 1, 2, 3].map((index) => (
            <StatCardSkeleton key={index} />
          ))}
        </div>
      </PanelCard>
    );
  }

  const { collectedMinor, cogsMinor, expensesMinor, netIncomeMinor } = summary.current;
  const margin = marginPct(collectedMinor, netIncomeMinor);
  /*
   * Break-even: expenses ÷ the contribution margin — the share of a sale left
   * after the goods it moved are paid for. With nothing sold there is no
   * margin to divide by, and with none of a sale left over no amount of sales
   * would ever cover the expenses; both read as a dash.
   */
  const contribution = collectedMinor === 0 ? 0 : (collectedMinor - cogsMinor) / collectedMinor;
  const breakEvenMinor = contribution > 0 ? expensesMinor / contribution : null;

  return (
    <PanelCard
      title={t("analytics.profitability.indicators.title")}
      hint={t("analytics.profitability.indicators.hint")}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          tone="success"
          icon={TrendingUp}
          label={t("analytics.profitability.indicators.monthlyExpenses")}
          value={
            <MoneyValue minor={Math.round(expensesMinor / months)} locale={locale} unit={unit} />
          }
          hint={t("analytics.profitability.indicators.perMonth")}
        />
        <StatCard
          tone="violet"
          icon={TrendingUp}
          label={t("analytics.profitability.indicators.monthlyProfit")}
          value={
            <MoneyValue minor={Math.round(netIncomeMinor / months)} locale={locale} unit={unit} />
          }
          hint={t("analytics.profitability.indicators.perMonth")}
        />
        <StatCard
          tone="info"
          icon={Percent}
          label={t("analytics.profitability.indicators.netMargin")}
          value={
            margin === null
              ? DASH
              : `${margin.toLocaleString(locale, { maximumFractionDigits: 2 })}%`
          }
          hint={t("analytics.profitability.indicators.netMarginHint")}
        />
        <StatCard
          tone="primary"
          icon={ArrowDownToLine}
          label={t("analytics.profitability.indicators.breakEven")}
          value={
            breakEvenMinor === null ? (
              DASH
            ) : (
              <MoneyValue minor={Math.round(breakEvenMinor)} locale={locale} unit={unit} />
            )
          }
          hint={t("analytics.profitability.indicators.breakEvenHint")}
        />
      </div>
    </PanelCard>
  );
}
