import type { ReactNode } from "react";

/**
 * `sortable` triggers `onSort` (server refetch). `clientSortable` sorts only
 * the currently-loaded rows in-memory via `sortAccessor` — used for columns
 * the backend doesn't support sorting on yet. A column should set at most one.
 */
export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly sortable?: boolean;
  readonly clientSortable?: boolean;
  readonly sortAccessor?: (row: T) => string | number | null;
  readonly width?: string;
  readonly align?: "start" | "end" | "center";
  readonly hideableAtNarrow?: boolean;
  readonly defaultVisible?: boolean;
}

export interface SortState {
  readonly key: string;
  readonly direction: "asc" | "desc";
}

export interface DataGridSelection {
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onToggleAll: (ids: string[]) => void;
}

export interface DataGridColumnVisibility {
  readonly visible: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}

export interface DataGridProps<T> {
  readonly columns: Column<T>[];
  readonly rows: T[];
  readonly getRowId: (row: T) => string;
  readonly loading: boolean;
  readonly loadingMore?: boolean;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void | Promise<void>;
  readonly sortState?: SortState | null;
  readonly onSort?: (key: string) => void;
  readonly selection?: DataGridSelection;
  readonly onRowClick?: (row: T) => void;
  readonly rowActions?: (row: T) => ReactNode;
  readonly emptyState: ReactNode;
  readonly columnVisibility?: DataGridColumnVisibility;
  readonly rowClassName?: (row: T) => string | undefined;
  readonly maxHeightClassName?: string;
  readonly sortHintLabel?: string;
}
