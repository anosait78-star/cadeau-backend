import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInfiniteScroll } from "./use-infinite-scroll";

let observerCallback: IntersectionObserverCallback = () => {};

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

function fire(intersecting: boolean): void {
  act(() => {
    observerCallback(
      [{ isIntersecting: intersecting } as IntersectionObserverEntry],
      new FakeIntersectionObserver(() => {}),
    );
  });
}

describe("useInfiniteScroll", () => {
  it("calls onLoadMore when the sentinel intersects and hasMore is true", () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, loading: false, onLoadMore }),
    );
    act(() => result.current.sentinelRef(document.createElement("tr")));
    fire(true);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("does not call onLoadMore when hasMore is false", () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: false, loading: false, onLoadMore }),
    );
    act(() => result.current.sentinelRef(document.createElement("tr")));
    fire(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not call onLoadMore when already loading", () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, loading: true, onLoadMore }),
    );
    act(() => result.current.sentinelRef(document.createElement("tr")));
    fire(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
