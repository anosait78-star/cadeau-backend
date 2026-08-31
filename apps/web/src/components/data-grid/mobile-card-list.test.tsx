import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { MobileCardList } from "./mobile-card-list";

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: "1", name: "first" },
  { id: "2", name: "second" },
];

/** Captures the observer so a test can drive the sentinel coming into view. */
let triggerIntersection: ((isIntersecting: boolean) => void) | null = null;

beforeEach(() => {
  triggerIntersection = null;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(): void {
        triggerIntersection = (isIntersecting) => {
          this.callback(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        };
      }
      disconnect(): void {}
      unobserve(): void {}
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderList(props: Partial<Parameters<typeof MobileCardList<Row>>[0]> = {}) {
  return render(
    <AppProviders>
      <MobileCardList<Row>
        items={ROWS}
        loading={false}
        getRowId={(row) => row.id}
        renderCard={(row) => <span>{row.name}</span>}
        emptyTitle="nothing here"
        hasMore={false}
        onLoadMore={() => undefined}
        loadMoreLabel="more"
        {...props}
      />
    </AppProviders>,
  );
}

describe("MobileCardList", () => {
  it("shows a shape-matched skeleton while loading, not the rows", () => {
    renderList({ loading: true });
    expect(screen.getByRole("status", { name: "nothing here" })).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("shows the empty state when there is nothing to list", () => {
    renderList({ items: [] });
    expect(screen.getByText("nothing here")).toBeInTheDocument();
  });

  it("renders a card per row", () => {
    renderList();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("loads the next page when the sentinel comes into view", async () => {
    const onLoadMore = vi.fn();
    renderList({ hasMore: true, onLoadMore });

    expect(onLoadMore).not.toHaveBeenCalled();
    triggerIntersection?.(true);
    await waitFor(() => expect(onLoadMore).toHaveBeenCalledOnce());
  });

  it("does not page while a load is already in flight", async () => {
    const release: { current: (() => void) | null } = { current: null };
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release.current = resolve;
        }),
    );
    renderList({ hasMore: true, onLoadMore });

    triggerIntersection?.(true);
    triggerIntersection?.(true);
    await waitFor(() => expect(onLoadMore).toHaveBeenCalledOnce());
    release.current?.();
  });

  it("falls back to an explicit control where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    renderList({ hasMore: true });
    expect(screen.getByRole("button", { name: "more" })).toBeInTheDocument();
  });
});
