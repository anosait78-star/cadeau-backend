import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";

export interface MobileCardListProps<T> {
  readonly items: T[];
  readonly loading: boolean;
  readonly getRowId: (row: T) => string;
  readonly renderCard: (row: T) => ReactNode;
  readonly emptyTitle: string;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void | Promise<void>;
  readonly loadMoreLabel: string;
}

/**
 * The generic *shape* of a mobile list screen (ADR-002's card alternative to
 * the desktop `DataGrid`): loading state, empty state, a card per row, and a
 * load-more button for keyset pagination. Each module still supplies its own
 * `renderCard` — this only standardizes the surrounding wiring.
 */
export function MobileCardList<T>({
  items,
  loading,
  getRowId,
  renderCard,
  emptyTitle,
  hasMore,
  onLoadMore,
  loadMoreLabel,
}: MobileCardListProps<T>): ReactNode {
  return (
    <>
      {loading ? <LoadingState /> : null}
      {!loading && items.length === 0 ? <EmptyState title={emptyTitle} /> : null}
      {!loading && items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((row) => (
            <li key={getRowId(row)}>{renderCard(row)}</li>
          ))}
        </ul>
      ) : null}
      {!loading && hasMore ? (
        <Button variant="outline" onClick={() => void onLoadMore()} className="self-center">
          {loadMoreLabel}
        </Button>
      ) : null}
    </>
  );
}
