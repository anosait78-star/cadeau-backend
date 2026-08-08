import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Tiny inline SVG trend line for the Orders KPI cards. Pure SVG, no charting
 * library — scoped to this page only, not a shared component.
 */
export function OrdersSparkline({
  values,
  className,
  toneClassName = "text-primary",
}: {
  values: readonly number[];
  className?: string;
  /** Sets the sparkline's color via `currentColor` (e.g. "text-primary", "text-success"). */
  toneClassName?: string;
}): ReactNode {
  const width = 100;
  const height = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn(toneClassName, className)}
      aria-hidden="true"
    >
      <polygon points={areaPoints} fill="currentColor" opacity="0.12" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
