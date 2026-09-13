import { CalendarRange, FileText, PieChart, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ExpenseSummary } from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { CurrencyAmount } from "./expense-display";

type Tone = "success" | "info" | "primary" | "warning";

const TONES: Readonly<Record<Tone, { readonly icon: string; readonly label: string }>> = {
  success: { icon: "bg-success/10 text-success", label: "text-success" },
  info: { icon: "bg-info/10 text-info", label: "text-info" },
  primary: { icon: "bg-primary/10 text-primary", label: "text-primary" },
  warning: { icon: "bg-warning/15 text-warning", label: "text-warning" },
};

/** A small badge under a stat. For spending, a rise reads red and a fall green. */
interface Pill {
  readonly text: string;
  readonly tone: "up" | "down" | "neutral";
}

const PILL_TONES: Readonly<Record<Pill["tone"], string>> = {
  up: "bg-destructive/10 text-destructive",
  down: "bg-success/10 text-success",
  neutral: "bg-muted text-muted-foreground",
};

/** Percent change from `previous` to `current`; `null` when last year had nothing to compare. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function trendPill(percent: number | null): Pill | null {
  if (percent === null) return null;
  const rounded = Math.round(percent);
  if (rounded === 0) return { text: "0%", tone: "neutral" };
  return rounded > 0 ? { text: `+${rounded}%`, tone: "up" } : { text: `${rounded}%`, tone: "down" };
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
          <div
            key={index}
            className="h-[118px] animate-pulse rounded-2xl border border-border bg-card lg:h-[152px]"
          />
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

function StatCard({
  tone,
  icon: Icon,
  label,
  value,
  valueClassName,
  detail = null,
  pill,
  hint,
}: {
  readonly tone: Tone;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: ReactNode;
  readonly valueClassName?: string;
  readonly detail?: ReactNode;
  readonly pill: Pill | null;
  readonly hint: string;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-xs lg:gap-4 lg:p-5">
      {/*
        A grid rather than a row, so the one markup lays out two ways. On a
        phone half a screen is too narrow for the figure beside the icon, so
        the label and icon share the top row and the figure takes a full-width
        row under them. From lg the icon spans all three rows and the text
        stacks beside it, as on the desktop design.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 lg:gap-x-3 lg:gap-y-1">
        <p
          className={cn(
            "col-start-1 row-start-1 line-clamp-2 self-center text-xs font-medium leading-snug lg:self-start lg:truncate lg:text-sm",
            TONES[tone].label,
          )}
        >
          {label}
        </p>
        <span
          aria-hidden="true"
          className={cn(
            "col-start-2 row-start-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg lg:row-span-3 lg:h-14 lg:w-14 lg:rounded-2xl",
            TONES[tone].icon,
          )}
        >
          <Icon className="h-4 w-4 lg:h-7 lg:w-7" />
        </span>
        <div
          className={cn(
            "col-span-2 row-start-2 min-w-0 text-base font-bold leading-tight text-foreground sm:text-lg lg:col-span-1 lg:col-start-1 lg:truncate lg:text-[1.75rem]",
            valueClassName,
          )}
        >
          {value}
        </div>
        {detail !== null ? (
          <div className="col-span-2 row-start-3 min-w-0 truncate text-xs text-muted-foreground lg:col-span-1 lg:col-start-1">
            {detail}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
          {hint}
        </p>
        {pill !== null ? (
          <span
            dir="ltr"
            className={cn(
              "ms-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              PILL_TONES[pill.tone],
            )}
          >
            {pill.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
