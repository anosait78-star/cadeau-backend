import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import type { Column, DataGridSelection, SortState } from "./types";

export function DataGridHeader<T>({
  columns,
  selection,
  allRowIds,
  isAllSelected,
  isIndeterminate,
  sortState,
  onSort,
  hasRowActions,
  sortHintLabel,
}: {
  columns: Column<T>[];
  selection?: DataGridSelection | undefined;
  allRowIds: string[];
  isAllSelected: (ids: string[]) => boolean;
  isIndeterminate: (ids: string[]) => boolean;
  sortState?: SortState | null | undefined;
  onSort?: ((key: string) => void) | undefined;
  hasRowActions: boolean;
  sortHintLabel: string;
}): ReactNode {
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current !== null)
      selectAllRef.current.indeterminate = isIndeterminate(allRowIds);
  });
  return (
    <thead>
      <tr className="sticky top-0 z-10 border-b border-border bg-muted text-xs text-muted-foreground">
        {selection !== undefined ? (
          <th className="w-10 px-3 py-2">
            <Checkbox
              checked={isAllSelected(allRowIds)}
              ref={selectAllRef}
              onChange={() => selection.onToggleAll(allRowIds)}
              aria-label="Select all"
            />
          </th>
        ) : null}
        {columns.map((column) => {
          const active = sortState?.key === column.key;
          const canSort = column.sortable === true || column.clientSortable === true;
          return (
            <th
              key={column.key}
              className={cn(
                "px-3 py-2 text-start font-medium",
                column.align === "end" && "text-end",
                column.align === "center" && "text-center",
                canSort && "cursor-pointer select-none",
              )}
              style={column.width !== undefined ? { width: column.width } : undefined}
              onClick={canSort ? () => onSort?.(column.key) : undefined}
              title={column.clientSortable === true ? sortHintLabel : undefined}
            >
              <span className="inline-flex items-center gap-1">
                {column.header}
                {canSort ? (
                  <span aria-hidden="true" className="text-[10px]">
                    {active ? (sortState?.direction === "asc" ? "▲" : "▼") : ""}
                    {column.clientSortable === true ? "·" : ""}
                  </span>
                ) : null}
              </span>
            </th>
          );
        })}
        {hasRowActions ? <th className="w-10 px-3 py-2" /> : null}
      </tr>
    </thead>
  );
}
