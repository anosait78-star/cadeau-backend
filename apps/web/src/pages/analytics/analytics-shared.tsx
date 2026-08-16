import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import type { SparklinePoint } from "@/features/analytics/analytics-api";
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

/** A labeled form field wrapper. */
export function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** One labeled numeric stat, matching the finance reports tab's convention. */
export function Stat({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${emphasize ? "text-base font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * A minimal, dependency-free sparkline: an inline `<svg><polyline>` scaled to
 * the series' own min/max (EPIC-14 — no charting library, keeps the bundle
 * budget intact). Renders nothing but a flat baseline when the series is
 * empty or constant, so it never divides by zero.
 */
export function Sparkline({
  points,
  width = 240,
  height = 48,
}: {
  points: readonly SparklinePoint[];
  width?: number;
  height?: number;
}): ReactNode {
  if (points.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label=""
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
      </svg>
    );
  }

  const values = points.map((p) => p.collectedMinor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * stepX : width / 2;
    const y = height - ((p.collectedMinor - min) / span) * height;
    return `${x},${y}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="sparkline"
      className="text-primary"
    >
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
