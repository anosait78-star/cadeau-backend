import type { ReactNode } from "react";
import type { StatPill } from "@/components/ui/stat-card";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";

/** Placeholder for a missing optional value. */
export const DASH = "—";

export { formatMoney };

/** Format a signed percentage delta, or a dash when there is no prior-period baseline. */
export function formatDeltaPct(pct: number | null, locale: string): string {
  if (pct === null) return DASH;
  const formatted = Math.abs(pct).toLocaleString(locale, { maximumFractionDigits: 1 });
  return pct >= 0 ? `+${formatted}%` : `-${formatted}%`;
}

/**
 * A period-over-period badge for a measure where growing is the good news —
 * revenue, units, profit. Returns `null` when the earlier period had nothing
 * to compare against, which draws no badge at all rather than a fake 0%.
 */
export function growthPill(pct: number | null, locale: string): StatPill | null {
  if (pct === null) return null;
  const text = formatDeltaPct(pct, locale);
  if (Math.round(pct) === 0) return { text, tone: "neutral" };
  return { text, tone: pct > 0 ? "positive" : "negative" };
}

/** A minor-unit amount over its currency code, as the stat cards show it. */
export function MoneyValue({
  minor,
  locale,
  unit,
}: {
  readonly minor: number;
  readonly locale: string;
  readonly unit: string;
}): ReactNode {
  return (
    <span className="flex flex-col leading-tight">
      <span className="truncate tabular-nums">{formatMoney(minor, locale)}</span>
      <span className="text-[0.6em] font-medium text-muted-foreground">{unit}</span>
    </span>
  );
}

/**
 * The frame every chart and table on this page sits in: a titled card with a
 * hint under the title and room for a badge or a link in its header.
 */
export function PanelCard({
  title,
  hint,
  icon = null,
  actions = null,
  footer = null,
  className,
  headerClassName,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly icon?: ReactNode;
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string | undefined;
  readonly headerClassName?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs",
        className,
      )}
    >
      <header
        className={cn(
          "flex items-start justify-between gap-3 px-4 py-3.5 lg:px-5 lg:py-4",
          headerClassName,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground lg:text-lg">{title}</h3>
            {hint !== undefined ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground lg:text-sm">{hint}</p>
            ) : null}
          </div>
        </div>
        {actions}
      </header>
      <div className="min-w-0 flex-1 px-4 pb-4 lg:px-5 lg:pb-5">{children}</div>
      {footer}
    </section>
  );
}
