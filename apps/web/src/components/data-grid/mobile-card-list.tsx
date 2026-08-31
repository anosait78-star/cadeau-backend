import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import { CardListSkeleton } from "@/components/states/skeleton";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

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
 * the desktop `DataGrid`): a skeleton while loading, an empty state, a card per
 * row, and **paging that happens on its own** as the end of the list comes into
 * view. Each module still supplies its own `renderCard` — this only standardizes
 * the surrounding wiring.
 *
 * The explicit "load more" button remains for browsers without
 * `IntersectionObserver`, where the sentinel can never fire; where the sentinel
 * works, a list that stops to ask permission to continue is the web showing
 * through.
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
  const { sentinelRef, supported } = useInfiniteScroll({ hasMore, onLoadMore });

  if (loading) return <CardListSkeleton label={emptyTitle} />;
  if (items.length === 0) return <EmptyState title={emptyTitle} />;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((row) => (
          <li key={getRowId(row)}>{renderCard(row)}</li>
        ))}
      </ul>

      {hasMore ? (
        <>
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          {supported ? (
            <div className="flex justify-center py-4">
              <Spinner label={loadMoreLabel} />
            </div>
          ) : (
            <Button variant="outline" onClick={() => void onLoadMore()} className="self-center">
              {loadMoreLabel}
            </Button>
          )}
        </>
      ) : null}
    </>
  );
}
