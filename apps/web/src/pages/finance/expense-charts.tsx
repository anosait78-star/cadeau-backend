import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { expenseCategoryStyle, tint, tintText } from "@/features/finance/expense-category-style";
import type { ExpenseSummary } from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { CurrencyAmount } from "./expense-display";
import { formatMoney } from "./finance-shared";

/*
 * Both charts are plain markup and SVG, like the dashboard's — the app carries
 * no charting library, and two simple charts do not justify one.
 */

/** Categories shown by name in the breakdown; the rest fold into "Other". */
const MAX_SLICES = 5;

function ChartCard({
  title,
  hint,
  actions = null,
  className,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly actions?: ReactNode;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-xs lg:p-5",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground lg:text-lg">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground lg:text-sm">{hint}</p>
        </div>
        {actions}
      </header>
      {children}
    </section>
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

function monthName(month: number, locale: string, style: "short" | "long"): string {
  return new Date(Date.UTC(2020, month - 1, 15)).toLocaleString(locale, {
    month: style,
    timeZone: "UTC",
  });
}

/**
 * The picked year's spending per month, January to December, with the year
 * picker and a refresh button in its header.
 *
 * Time runs left to right in both languages, as on any chart axis. On a phone
 * the twelve months keep a readable width and the plot scrolls sideways
 * instead of squeezing the labels into nothing; a screen reader gets the same
 * figures as a list.
 */
export function MonthlyExpensesChart({
  summary,
  year,
  years,
  onYearChange,
  onRefresh,
  className,
}: {
  readonly summary: ExpenseSummary | null;
  readonly year: number;
  readonly years: readonly number[];
  readonly onYearChange: (year: number) => void;
  readonly onRefresh: () => void;
  readonly className?: string | undefined;
}): ReactNode {
  const { t, locale } = useI18n();

  const actions = (
    <div className="flex shrink-0 items-center gap-2">
      <label htmlFor="expense-summary-year" className="sr-only">
        {t("finance.expenses.chart.year")}
      </label>
      <select
        id="expense-summary-year"
        value={year}
        onChange={(event) => onYearChange(Number(event.target.value))}
        className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {years.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        onClick={onRefresh}
        aria-label={t("finance.expenses.chart.refresh")}
      >
        <RotateCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <ChartCard
      className={className}
      title={t("finance.expenses.chart.monthly")}
      hint={t("finance.expenses.chart.monthlyHint")}
      actions={actions}
    >
      {summary === null ? (
        <div className="h-56 animate-pulse rounded-xl bg-muted lg:h-64" />
      ) : (
        <MonthlyBars monthly={summary.monthly} locale={locale} />
      )}
    </ChartCard>
  );
}

function MonthlyBars({
  monthly,
  locale,
}: {
  readonly monthly: ExpenseSummary["monthly"];
  readonly locale: string;
}): ReactNode {
  const axisMax = niceCeil(Math.max(0, ...monthly.map((m) => m.totalMinor)) / 100);
  const ticks = [4, 3, 2, 1, 0].map((step) => (axisMax * step) / 4);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const top = (value: number): string => `${100 - (value / axisMax) * 100}%`;

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div dir="ltr" aria-hidden="true" className="min-w-[520px] pt-2">
          <div className="flex h-44 lg:h-52">
            <div className="relative w-11 shrink-0 text-[10px] tabular-nums text-muted-foreground lg:w-12 lg:text-xs">
              {ticks.map((value) => (
                <span
                  key={value}
                  className="absolute end-2 -translate-y-1/2 leading-none"
                  style={{ top: top(value) }}
                >
                  {compact.format(value)}
                </span>
              ))}
            </div>
            <div className="relative flex-1">
              {ticks.map((value) => (
                <div
                  key={value}
                  className="absolute inset-x-0 border-t border-dashed border-border"
                  style={{ top: top(value) }}
                />
              ))}
              <div className="absolute inset-0 flex items-end gap-1.5 px-1 lg:gap-2">
                {monthly.map((entry) => (
                  <div key={entry.month} className="flex h-full flex-1 items-end justify-center">
                    {entry.totalMinor > 0 ? (
                      <div
                        className="w-full max-w-[34px] rounded-t-md bg-primary/75 transition-colors hover:bg-primary"
                        style={{
                          height: `${Math.max((entry.totalMinor / 100 / axisMax) * 100, 1.5)}%`,
                        }}
                        title={`${monthName(entry.month, locale, "long")}: ${formatMoney(entry.totalMinor, locale)}`}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 flex">
            <div className="w-11 shrink-0 lg:w-12" />
            <div className="flex flex-1 gap-1.5 px-1 lg:gap-2">
              {monthly.map((entry) => (
                <span
                  key={entry.month}
                  className="flex-1 truncate text-center text-[10px] text-muted-foreground lg:text-xs"
                >
                  {monthName(entry.month, locale, "short")}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <ul className="sr-only">
        {monthly.map((entry) => (
          <li key={entry.month}>
            {monthName(entry.month, locale, "long")}: {formatMoney(entry.totalMinor, locale)}
          </li>
        ))}
      </ul>
    </>
  );
}

interface Slice {
  readonly key: string;
  readonly label: string;
  readonly totalMinor: number;
  readonly color: string;
}

/**
 * How the picked year's spending splits across categories: a ring with the
 * total in its middle, and a legend of each category's amount and share.
 * Beyond {@link MAX_SLICES} categories the smallest fold into "Other", so the
 * ring stays legible.
 *
 * Side by side on desktop; on a phone the ring sits on top and the legend
 * runs full width beneath it.
 */
export function ExpenseCategoryChart({
  summary,
  className,
}: {
  readonly summary: ExpenseSummary | null;
  readonly className?: string | undefined;
}): ReactNode {
  const { t, locale } = useI18n();

  return (
    <ChartCard
      className={className}
      title={t("finance.expenses.chart.byCategory")}
      hint={t("finance.expenses.chart.byCategoryHint")}
    >
      {summary === null ? (
        <div className="h-56 animate-pulse rounded-xl bg-muted lg:h-64" />
      ) : (
        <CategoryBreakdown summary={summary} locale={locale} />
      )}
    </ChartCard>
  );
}

function CategoryBreakdown({
  summary: data,
  locale: displayLocale,
}: {
  readonly summary: ExpenseSummary;
  readonly locale: string;
}): ReactNode {
  const { t } = useI18n();
  const total = data.current.totalMinor;
  const unit = t("finance.expenses.currency");

  const named =
    data.byCategory.length > MAX_SLICES
      ? data.byCategory.slice(0, MAX_SLICES - 1)
      : data.byCategory;
  const rest = data.byCategory.slice(named.length);
  const slices: Slice[] = named.map((entry) => ({
    key: entry.category,
    label: entry.category,
    totalMinor: entry.totalMinor,
    color: expenseCategoryStyle(entry.category).color,
  }));
  if (rest.length > 0) {
    slices.push({
      key: "__other__",
      label: t("finance.expenses.chart.others"),
      totalMinor: rest.reduce((sum, entry) => sum + entry.totalMinor, 0),
      color: "var(--muted-foreground)",
    });
  }

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const segments = slices.reduce<{ slice: Slice; length: number; offset: number }[]>(
    (acc, slice) => {
      const previous = acc[acc.length - 1];
      const offset = previous === undefined ? 0 : previous.offset + previous.length;
      const length = total > 0 ? (slice.totalMinor / total) * circumference : 0;
      return [...acc, { slice, length, offset }];
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col-reverse items-center gap-5 sm:flex-row sm:gap-6">
        {slices.length > 0 ? (
          <ul className="flex w-full min-w-0 flex-1 flex-col divide-y divide-border">
            {slices.map((slice) => {
              const percent = total > 0 ? (slice.totalMinor / total) * 100 : 0;
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
                      <CurrencyAmount
                        minor={slice.totalMinor}
                        locale={displayLocale}
                        unit={unit}
                        className="text-xs text-muted-foreground"
                      />
                    </div>
                  </div>
                  <span
                    dir="ltr"
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                    style={{ backgroundColor: tint(slice.color, 14), color: tintText(slice.color) }}
                  >
                    {`${percent.toFixed(1)}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
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
            {segments.map(({ slice, length, offset }) => (
              <circle
                key={slice.key}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                strokeWidth="12"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                style={{ stroke: slice.color }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <span className="text-base font-bold tabular-nums leading-tight text-foreground lg:text-lg">
              {formatMoney(total, displayLocale)}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">{unit}</span>
            <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
              {t("finance.expenses.chart.totalLabel")}
            </span>
          </div>
        </div>
      </div>
      {total === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          {t("finance.expenses.chart.empty", { year: data.year })}
        </p>
      ) : null}
    </div>
  );
}
