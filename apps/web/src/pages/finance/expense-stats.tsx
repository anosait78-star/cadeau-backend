import { CalendarRange, FileText, PieChart, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { StatCard, StatCardSkeleton, type StatPill } from "@/components/ui/stat-card";
import type { ExpenseSummary } from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { CurrencyAmount } from "./expense-display";

/** Percent change from `previous` to `current`; `null` when last year had nothing to compare. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Spending, so a rise reads as bad news and a fall as good. */
function trendPill(percent: number | null): StatPill | null {
  if (percent === null) return null;
  const rounded = Math.round(percent);
  if (rounded === 0) return { text: "0%", tone: "neutral" };
  return rounded > 0
    ? { text: `+${rounded}%`, tone: "negative" }
    : { text: `${rounded}%`, tone: "positive" };
}

/**
 * The four headline numbers for the picked year: the top category and its
 * share, how many expenses, their total, and the monthly average — each of
 * the last three against the same span last year. `summary` is `null` while
 * it loads, which draws placeholders of the same size so nothing jumps.
 *
 * Two per row on a phone (icon shrunk, the comparison sentence dropped, the
 * badge kept), four across on desktop.
 */
export function ExpenseStats({ summary }: { readonly summary: ExpenseSummary | null }): ReactNode {
  const { t, locale } = useI18n();
  const unit = t("finance.expenses.currency");

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
  const top = summary.byCategory[0];
  const share =
    top !== undefined && current.totalMinor > 0
      ? (top.totalMinor / current.totalMinor) * 100
      : null;
  const vsPrevious = t("finance.expenses.stats.vsPrevious");

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatCard
        tone="success"
        icon={PieChart}
        label={t("finance.expenses.stats.topCategory")}
        value={top?.category ?? t("finance.expenses.stats.none")}
        valueClassName="lg:text-2xl"
        detail={
          top !== undefined ? (
            <CurrencyAmount minor={top.totalMinor} locale={locale} unit={unit} />
          ) : null
        }
        pill={share === null ? null : { text: `${share.toFixed(1)}%`, tone: "neutral" }}
        hint={t("finance.expenses.stats.topCategoryShare")}
      />
      <StatCard
        tone="info"
        icon={FileText}
        label={t("finance.expenses.stats.count")}
        value={current.count.toLocaleString(locale)}
        pill={trendPill(percentChange(current.count, previous.count))}
        hint={vsPrevious}
      />
      <StatCard
        tone="primary"
        icon={Wallet}
        label={t("finance.expenses.stats.total")}
        value={<CurrencyAmount minor={current.totalMinor} locale={locale} unit={unit} />}
        pill={trendPill(percentChange(current.totalMinor, previous.totalMinor))}
        hint={vsPrevious}
      />
      <StatCard
        tone="warning"
        icon={CalendarRange}
        label={t("finance.expenses.stats.average")}
        value={<CurrencyAmount minor={current.averageMonthlyMinor} locale={locale} unit={unit} />}
        pill={trendPill(percentChange(current.averageMonthlyMinor, previous.averageMonthlyMinor))}
        hint={t("finance.expenses.stats.averageHint")}
      />
    </div>
  );
}
