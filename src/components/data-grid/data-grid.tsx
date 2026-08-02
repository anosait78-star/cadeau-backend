import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DataGridHeader } from "./data-grid-header";
import { DataGridRow } from "./data-grid-row";
import { DataGridSkeleton } from "./data-grid-skeleton";
import type { DataGridProps, SortState } from "./types";
import { useInfiniteScroll } from "./use-infinite-scroll";
import { useRovingRowFocus } from "./use-roving-row-focus";

export type {
  Column,
  DataGridProps,
  SortState,
  DataGridSelection,
  DataGridColumnVisibility,
} from "./types";
export { useDataGridSelection } from "./use-data-grid-selection";

/**
 * Generic, data-shape-agnostic data grid: sortable columns, row selection,
 * bulk-action-ready, sticky header, loading skeleton, empty state, infinite
 * scroll (keyset pagination via onLoadMore/hasMore), row-level keyboard nav.
 */
export function DataGrid<T>({
  columns,
  rows,
  getRowId,
  loading,
  loadingMore = false,
  hasMore,
  onLoadMore,
  sortState = null,
  onSort,
  selection,
  onRowClick,
  rowActions,
  emptyState,
  columnVisibility,
  rowClassName,
  maxHeightClassName = "max-h-[70vh]",
  sortHintLabel = "Sorts loaded rows only",
}: DataGridProps<T>): ReactNode {
  const visibleColumns = useMemo(
    () =>
      columnVisibility === undefined
        ? columns
        : columns.filter((c) => columnVisibility.visible.has(c.key)),
    [columns, columnVisibility],
  );

  const [clientSort, setClientSort] = useState<SortState | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const effectiveSort = sortState ?? clientSort;

  const displayRows = useMemo(() => {
    if (clientSort === null) return rows;
    const column = columns.find((c) => c.key === clientSort.key);
    if (column?.sortAccessor === undefined) return rows;
    const accessor = column.sortAccessor;
    const sorted = [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (clientSort.direction === "desc") sorted.reverse();
    return sorted;
  }, [rows, clientSort, columns]);

  const handleSort = (key: string): void => {
    const column = columns.find((c) => c.key === key);
    if (column === undefined) return;
    if (column.sortable === true) {
      onSort?.(key);
      setClientSort(null);
      return;
    }
    if (column.clientSortable === true) {
      setClientSort((prev) => {
        if (prev?.key === key) {
          return prev.direction === "desc" ? { key, direction: "asc" } : null;
        }
        return { key, direction: "desc" };
      });
    }
  };

  const rowIds = displayRows.map(getRowId);
  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    loading: loading || loadingMore,
    onLoadMore,
  });
  const { onKeyDown } = useRovingRowFocus({
    rowIds,
    focusedId,
    setFocusedId,
    onOpen:
      onRowClick === undefined
        ? undefined
        : (id) => {
            const row = displayRows.find((r) => getRowId(r) === id);
            if (row !== undefined) onRowClick(row);
          },
    onToggleSelect: selection?.onToggle,
    onLoadMore,
    hasMore,
  });

  const columnCount =
    visibleColumns.length + (selection === undefined ? 0 : 1) + (rowActions === undefined ? 0 : 1);

  return (
    <div className={cn("overflow-auto rounded-lg border border-border", maxHeightClassName)}>
      <table className="w-full text-sm">
        <DataGridHeader
          columns={visibleColumns}
          selection={selection}
          allRowIds={rowIds}
          isAllSelected={(ids) =>
            ids.length > 0 && ids.every((id) => selection?.selectedIds.has(id) === true)
          }
          isIndeterminate={(ids) =>
            ids.some((id) => selection?.selectedIds.has(id) === true) &&
            !ids.every((id) => selection?.selectedIds.has(id) === true)
          }
          sortState={effectiveSort}
          onSort={handleSort}
          hasRowActions={rowActions !== undefined}
          sortHintLabel={sortHintLabel}
        />
        <tbody onKeyDown={onKeyDown}>
          {loading ? (
            <DataGridSkeleton columnCount={columnCount} />
          ) : displayRows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, columnCount)} className="px-3 py-10">
                {emptyState}
              </td>
            </tr>
          ) : (
            <>
              {displayRows.map((row) => {
                const rowId = getRowId(row);
                return (
                  <DataGridRow
                    key={rowId}
                    row={row}
                    rowId={rowId}
                    columns={visibleColumns}
                    selection={selection}
                    onRowClick={onRowClick}
                    rowActions={rowActions}
                    rowClassName={rowClassName?.(row)}
                    focused={focusedId === null ? rowId === rowIds[0] : focusedId === rowId}
                    onFocusRow={setFocusedId}
                  />
                );
              })}
              <tr ref={sentinelRef} aria-hidden="true" className="h-0">
                <td colSpan={Math.max(1, columnCount)} />
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
