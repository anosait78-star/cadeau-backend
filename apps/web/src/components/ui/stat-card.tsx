import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The accent a card wears: its icon tile, its label, and nothing else. */
export type StatTone = "success" | "info" | "primary" | "warning" | "violet" | "destructive";

const TONES: Readonly<Record<StatTone, { readonly icon: string; readonly label: string }>> = {
  success: { icon: "bg-success/10 text-success", label: "text-success" },
  info: { icon: "bg-info/10 text-info", label: "text-info" },
  primary: { icon: "bg-primary/10 text-primary", label: "text-primary" },
  warning: { icon: "bg-warning/15 text-warning", label: "text-warning" },
  violet: { icon: "bg-violet/10 text-violet", label: "text-violet" },
  destructive: { icon: "bg-destructive/10 text-destructive", label: "text-destructive" },
};

/**
 * A small badge under a stat. Its tone says whether the change is good news,
 * not which way the number moved — the caller decides that, because the same
 * direction reads differently per measure: revenue rising is good news,
 * spending rising is not.
 */
export interface StatPill {
  readonly text: string;
  readonly tone: "positive" | "negative" | "neutral";
}

const PILL_TONES: Readonly<Record<StatPill["tone"], string>> = {
  positive: "bg-success/10 text-success",
  negative: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * One headline figure: a tinted icon tile, a label, the number, an optional
 * line under it, and a footer holding a comparison sentence and a percentage
 * badge.
 *
 * Shared by the finance and analytics pages, which show the same kind of row
 * of four. Two per row on a phone — where the figure moves to its own line so
 * a long number is never squeezed beside the icon — and four across from
 * `lg`, with the icon spanning the stacked text.
 */
export function StatCard({
  tone,
  icon: Icon,
  label,
  value,
  valueClassName,
  detail = null,
  pill = null,
  hint,
}: {
  readonly tone: StatTone;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: ReactNode;
  readonly valueClassName?: string;
  readonly detail?: ReactNode;
  readonly pill?: StatPill | null;
  readonly hint: string;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-xs lg:gap-4 lg:p-5">
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

/** The same card's shape while it loads, so nothing shifts when data lands. */
export function StatCardSkeleton(): ReactNode {
  return (
    <div className="h-[118px] animate-pulse rounded-2xl border border-border bg-card lg:h-[152px]" />
  );
}
