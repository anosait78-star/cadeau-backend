import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface StatusStepperStep {
  readonly key: string;
  readonly label: string;
}

export interface StatusStepperProps {
  readonly steps: readonly StatusStepperStep[];
  /** Index of the step currently active. -1 means nothing reached yet. */
  readonly currentIndex: number;
  readonly className?: string;
}

/**
 * Fixed-count horizontal stepper (new → processing → ready → delivered, or
 * any similarly small stage list). Built with flexible connectors instead of
 * fixed widths so it never overflows its container on narrow screens — step
 * labels hide below `sm` and the current stage's badge (rendered by the
 * caller) carries that information on mobile instead.
 */
export function StatusStepper({ steps, currentIndex, className }: StatusStepperProps): ReactNode {
  return (
    <ol className={cn("flex w-full items-start", className)}>
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <li key={step.key} className="flex min-w-0 flex-1 flex-col items-center last:flex-none">
            <div className="flex w-full items-center">
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 min-w-3 flex-1",
                    index <= currentIndex ? "bg-success" : "bg-border",
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 sm:h-7 sm:w-7",
                  isCompleted && "border-success bg-success text-success-foreground",
                  isCurrent && "border-primary bg-primary/10 text-primary",
                  !isCompleted && !isCurrent && "border-border bg-muted text-muted-foreground",
                )}
              >
                {isCompleted ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isCurrent ? "bg-primary" : "bg-border",
                    )}
                    aria-hidden
                  />
                )}
              </span>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 min-w-3 flex-1",
                    index < currentIndex ? "bg-success" : "bg-border",
                  )}
                />
              ) : null}
            </div>
            <span
              className={cn(
                "mt-1 hidden text-center text-[11px] leading-tight sm:block",
                isCurrent ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
