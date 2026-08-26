import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ProgressRingProps {
  /** 0–100. Values outside that range are clamped. */
  readonly value: number;
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly className?: string;
  readonly trackClassName?: string;
  readonly indicatorClassName?: string;
  readonly children?: ReactNode;
}

/**
 * Circular progress indicator. The SVG's own -90° rotation (to start the arc
 * at 12 o'clock) is a local coordinate transform, so it reads the same in
 * both LTR and RTL documents — no direction-specific handling needed.
 */
export function ProgressRing({
  value,
  size = 88,
  strokeWidth = 8,
  className,
  trackClassName,
  indicatorClassName,
  children,
}: ProgressRingProps): ReactNode {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={cn("stroke-muted", trackClassName)}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            "stroke-success transition-[stroke-dashoffset] duration-500 ease-out",
            indicatorClassName,
          )}
        />
      </svg>
      {children !== undefined ? (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      ) : null}
    </div>
  );
}
