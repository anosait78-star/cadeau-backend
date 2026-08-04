import type { ReactNode } from "react";
import type { SparklinePoint } from "@/features/analytics/analytics-api";
import { ORDER_STATUSES, type OrderStatus } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import type { Translate } from "@/components/i18n/translate-type";

/**
 * A minimal, dependency-free bar chart for the business summary's revenue
 * series (EPIC-14/16 convention — no charting library, same reasoning as
 * `analytics-shared.tsx`'s `Sparkline`). Renders a flat baseline when there
 * is no data, so it never divides by zero.
 */
export function SalesChart({
  points,
  width = 560,
  height = 160,
}: {
  points: readonly SparklinePoint[];
  width?: number;
  height?: number;
}): ReactNode {
  if (points.length === 0) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="">
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
      </svg>
    );
  }

  const values = points.map((p) => p.collectedMinor);
  const max = Math.max(...values, 1);
  const gap = 4;
  const barWidth = points.length > 0 ? width / points.length - gap : width;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="sales"
      className="text-primary"
    >
      {points.map((p, i) => {
        const barHeight = Math.max(1, (p.collectedMinor / max) * (height - 4));
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        return (
          <rect
            key={p.bucket}
            x={x}
            y={y}
            width={Math.max(1, barWidth)}
            height={barHeight}
            fill="currentColor"
            rx={2}
          />
        );
      })}
    </svg>
  );
}

/**
 * A horizontal bar per order status, scaled to the largest count. Purely
 * presentational over `orderStatusCounts()` — carries no lifecycle logic.
 */
export function StatusChart({
  counts,
  t,
}: {
  counts: Record<string, number>;
  t: Translate;
}): ReactNode {
  const max = Math.max(...ORDER_STATUSES.map((s) => counts[s] ?? 0), 1);
  return (
    <ul className="flex flex-col gap-2">
      {ORDER_STATUSES.map((status: OrderStatus) => {
        const count = counts[status] ?? 0;
        const pct = (count / max) * 100;
        return (
          <li key={status} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 truncate text-muted-foreground">
              {t(`orders.status.${status}` as TranslationKey)}
            </span>
            <span className="h-3 flex-1 overflow-hidden rounded bg-muted">
              <span className="block h-full rounded bg-primary" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-8 shrink-0 text-end tabular-nums">{count}</span>
          </li>
        );
      })}
    </ul>
  );
}
