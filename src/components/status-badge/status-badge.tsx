import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "destructive" | "info";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-primary/15 text-primary",
};

export interface StatusBadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
  readonly className?: string;
  readonly testId?: string;
}

/**
 * Generic status/payment/tag chip. Carries no domain knowledge — each module
 * supplies its own `status → tone` map (e.g. `orders-status-tones.ts`) and
 * passes the resolved tone + translated label in.
 */
export function StatusBadge({
  label,
  tone = "neutral",
  className,
  testId,
}: StatusBadgeProps): ReactNode {
  return (
    <span
      className={cn("rounded px-1.5 py-0.5 text-xs font-medium", TONE_CLASSES[tone], className)}
      data-testid={testId ?? "status-badge"}
    >
      {label}
    </span>
  );
}
