import { useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import type { Column, DataGridSelection } from "./types";

const INTERACTIVE_SELECTOR = 'button, a, input, [role="menuitem"], [data-stop-row-click]';

export function DataGridRow<T>({
  row,
  rowId,
  columns,
  selection,
  onRowClick,
  rowActions,
  rowClassName,
  focused,
  onFocusRow,
}: {
  row: T;
  rowId: string;
  columns: Column<T>[];
  selection?: DataGridSelection | undefined;
  onRowClick?: ((row: T) => void) | undefined;
  rowActions?: ((row: T) => ReactNode) | undefined;
  rowClassName?: string | undefined;
  focused: boolean;
  onFocusRow: (id: string) => void;
}): ReactNode {
  const clickable = onRowClick !== undefined;
  const rowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    // Only steal DOM focus when the grid already has focus somewhere (i.e. the
    // user is navigating with the keyboard) - never auto-focus on mount.
    if (focused && document.activeElement?.closest("[data-row-id]") !== null) {
      rowRef.current?.focus();
    }
  }, [focused]);

  const handleClick = (event: MouseEvent<HTMLTableRowElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE_SELECTOR) !== null) return;
    onRowClick?.(row);
  };

  return (
    <tr
      ref={rowRef}
      data-row-id={rowId}
      tabIndex={focused ? 0 : -1}
      onFocus={() => onFocusRow(rowId)}
      onClick={clickable ? handleClick : undefined}
      className={cn(
        "border-b border-border text-sm last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        clickable && "cursor-pointer hover:bg-muted/50",
        rowClassName,
      )}
    >
      {selection !== undefined ? (
        <td className="w-10 px-3 py-2">
          <Checkbox
            checked={selection.selectedIds.has(rowId)}
            onChange={() => selection.onToggle(rowId)}
            aria-label="Select row"
          />
        </td>
      ) : null}
      {columns.map((column) => (
        <td
          key={column.key}
          className={cn(
            "px-3 py-2.5",
            column.align === "end" && "text-end",
            column.align === "center" && "text-center",
          )}
        >
          {column.render(row)}
        </td>
      ))}
      {rowActions !== undefined ? (
        <td className="w-10 px-3 py-2 text-end" data-stop-row-click>
          {rowActions(row)}
        </td>
      ) : null}
    </tr>
  );
}
