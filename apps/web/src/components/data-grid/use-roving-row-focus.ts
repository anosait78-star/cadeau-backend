import type { KeyboardEvent } from "react";

/**
 * Row-level roving tabindex keyboard model (not a full 2-D ARIA grid): only
 * the focused row is tabbable, Arrow/Home/End move focus row-to-row, Enter
 * opens the row, Space toggles its selection. Delegated onto the tbody.
 */
export function useRovingRowFocus({
  rowIds,
  focusedId,
  setFocusedId,
  onOpen,
  onToggleSelect,
  onLoadMore,
  hasMore,
}: {
  rowIds: string[];
  focusedId: string | null;
  setFocusedId: (id: string) => void;
  onOpen?: ((id: string) => void) | undefined;
  onToggleSelect?: ((id: string) => void) | undefined;
  onLoadMore?: (() => void | Promise<void>) | undefined;
  hasMore: boolean;
}): { onKeyDown: (event: KeyboardEvent<HTMLTableSectionElement>) => void } {
  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>): void => {
    if (rowIds.length === 0) return;
    const currentIndex = focusedId === null ? -1 : rowIds.indexOf(focusedId);

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        if (currentIndex >= rowIds.length - 1) {
          if (hasMore) void onLoadMore?.();
          return;
        }
        setFocusedId(rowIds[currentIndex + 1] as string);
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        const prevIndex = Math.max(0, currentIndex - 1);
        setFocusedId(rowIds[prevIndex] as string);
        return;
      }
      case "Home": {
        event.preventDefault();
        setFocusedId(rowIds[0] as string);
        return;
      }
      case "End": {
        event.preventDefault();
        setFocusedId(rowIds[rowIds.length - 1] as string);
        return;
      }
      case "Enter": {
        if (focusedId !== null) onOpen?.(focusedId);
        return;
      }
      case " ": {
        if (focusedId !== null) {
          event.preventDefault();
          onToggleSelect?.(focusedId);
        }
        return;
      }
      default:
        return;
    }
  };

  return { onKeyDown };
}
