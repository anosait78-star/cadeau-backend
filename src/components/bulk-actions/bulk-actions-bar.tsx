import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface BulkActionsBarProps {
  readonly count: number;
  readonly onClear: () => void;
  readonly actions: ReactNode;
  readonly countLabel: (count: number) => string;
  readonly clearLabel: string;
}

/**
 * Sticky bar shown above/below a grid once rows are selected. Carries no
 * business logic — `actions` is composed by the consuming page against its
 * own bulk-mutation calls.
 */
export function BulkActionsBar({
  count,
  onClear,
  actions,
  countLabel,
  clearLabel,
}: BulkActionsBarProps): ReactNode {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
    >
      <span className="font-medium">{countLabel(count)}</span>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
      <Button variant="ghost" size="sm" className="ms-auto" onClick={onClear}>
        {clearLabel}
      </Button>
    </div>
  );
}
