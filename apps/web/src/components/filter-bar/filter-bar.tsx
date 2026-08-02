import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface FilterBarProps {
  /** One control per active filter (a `<Select>`, date range, toggle, ...) — supplied by the page. */
  readonly children: ReactNode;
  /** Count of currently-active (non-default) filters, shown as a chip. */
  readonly activeCount: number;
  readonly onClearAll?: () => void;
  readonly clearAllLabel: string;
  readonly className?: string;
}

/**
 * Generic filter-row shell: lays out whatever filter controls a page passes
 * in, plus an active-filter-count chip and a "clear all" action. Carries no
 * filter definitions itself — those are entirely page-specific.
 */
export function FilterBar({
  children,
  activeCount,
  onClearAll,
  clearAllLabel,
  className,
}: FilterBarProps): ReactNode {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {children}
      {activeCount > 0 ? (
        <div className="flex items-center gap-2">
          <span
            className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
            data-testid="filter-bar-active-count"
          >
            {activeCount}
          </span>
          {onClearAll !== undefined ? (
            <Button variant="ghost" size="sm" onClick={onClearAll}>
              {clearAllLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
