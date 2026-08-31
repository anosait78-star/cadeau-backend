import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePullToRefresh } from "./use-pull-to-refresh";

function pointer(y: number) {
  return { pointerType: "touch", clientY: y } as unknown as React.PointerEvent<HTMLElement>;
}

function setScrollY(value: number): void {
  Object.defineProperty(window, "scrollY", { value, configurable: true, writable: true });
}

afterEach(() => setScrollY(0));

describe("usePullToRefresh", () => {
  it("refreshes when pulled past the trigger and released", async () => {
    setScrollY(0);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => result.current.handlers.onPointerDown(pointer(100)));
    act(() => result.current.handlers.onPointerMove(pointer(400)));
    expect(result.current.armed).toBe(true);
    act(() => result.current.handlers.onPointerUp());

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });

  it("does not refresh when released short of the trigger", () => {
    setScrollY(0);
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => result.current.handlers.onPointerDown(pointer(100)));
    act(() => result.current.handlers.onPointerMove(pointer(140)));
    expect(result.current.armed).toBe(false);
    act(() => result.current.handlers.onPointerUp());

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.distance).toBe(0);
  });

  it("ignores the gesture when the page is already scrolled", () => {
    setScrollY(240);
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => result.current.handlers.onPointerDown(pointer(100)));
    act(() => result.current.handlers.onPointerMove(pointer(400)));
    act(() => result.current.handlers.onPointerUp());

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.distance).toBe(0);
  });

  it("damps and caps the pull rather than tracking the finger", () => {
    setScrollY(0);
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));

    act(() => result.current.handlers.onPointerDown(pointer(100)));
    act(() => result.current.handlers.onPointerMove(pointer(200)));
    // 100px of finger travel must move the indicator less than 100px…
    expect(result.current.distance).toBeLessThan(100);

    act(() => result.current.handlers.onPointerMove(pointer(2000)));
    // …and no pull, however long, may exceed the cap.
    expect(result.current.distance).toBeLessThanOrEqual(110);
  });
});
