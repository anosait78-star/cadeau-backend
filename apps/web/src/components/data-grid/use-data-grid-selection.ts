import { useMemo, useState } from "react";
import type { DataGridSelection } from "./types";

/** Selection state for a data grid: a `Set<string>` of selected row ids. */
export function useDataGridSelection(): DataGridSelection & {
  readonly clear: () => void;
  readonly isAllSelected: (ids: string[]) => boolean;
  readonly isIndeterminate: (ids: string[]) => boolean;
} {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const onToggle = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onToggleAll = (ids: string[]): void => {
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  };

  const clear = (): void => setSelectedIds(new Set());

  const isAllSelected = useMemo(
    () => (ids: string[]) => ids.length > 0 && ids.every((id) => selectedIds.has(id)),
    [selectedIds],
  );
  const isIndeterminate = useMemo(
    () => (ids: string[]) => ids.some((id) => selectedIds.has(id)) && !isAllSelected(ids),
    [selectedIds, isAllSelected],
  );

  return { selectedIds, onToggle, onToggleAll, clear, isAllSelected, isIndeterminate };
}
