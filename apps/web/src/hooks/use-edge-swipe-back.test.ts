import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEdgeSwipeBack } from "./use-edge-swipe-back";

/** A pointer event shaped the way the hook reads it. */
function pointer(x: number, y = 0, time = 0) {
  return {
    pointerType: "touch",
    clientX: x,
    clientY: y,
    timeStamp: time,
    pointerId: 1,
  } as unknown as React.PointerEvent<HTMLElement>;
}

function setDirection(dir: "rtl" | "ltr"): void {
  document.documentElement.dir = dir;
}

afterEach(() => document.documentElement.removeAttribute("dir"));

describe("useEdgeSwipeBack", () => {
  it("commits when dragged far enough from the leading edge (LTR)", () => {
    setDirection("ltr");
    const onBack = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeBack({ enabled: true, onBack }));

    act(() => result.current.handlers.onPointerDown(pointer(8, 400, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(600, 400, 200)));
    expect(result.current.travel).toBeGreaterThan(0);
    act(() => result.current.handlers.onPointerUp(pointer(600, 400, 200)));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("commits from the opposite edge in RTL", () => {
    setDirection("rtl");
    const onBack = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeBack({ enabled: true, onBack }));

    const width = window.innerWidth;
    act(() => result.current.handlers.onPointerDown(pointer(width - 8, 400, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(width - 600, 400, 200)));
    expect(result.current.travel).toBeGreaterThan(0);
    act(() => result.current.handlers.onPointerUp(pointer(width - 600, 400, 200)));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("ignores a drag that does not start at the edge", () => {
    setDirection("ltr");
    const onBack = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeBack({ enabled: true, onBack }));

    act(() => result.current.handlers.onPointerDown(pointer(200, 400, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(700, 400, 200)));
    act(() => result.current.handlers.onPointerUp(pointer(700, 400, 200)));

    expect(onBack).not.toHaveBeenCalled();
    expect(result.current.travel).toBe(0);
  });

  it("does nothing when disabled (a root destination)", () => {
    setDirection("ltr");
    const onBack = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeBack({ enabled: false, onBack }));

    act(() => result.current.handlers.onPointerDown(pointer(4, 400, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(700, 400, 200)));
    act(() => result.current.handlers.onPointerUp(pointer(700, 400, 200)));

    expect(onBack).not.toHaveBeenCalled();
  });

  it("hands the gesture back when it turns out to be a vertical scroll", () => {
    setDirection("ltr");
    const onBack = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeBack({ enabled: true, onBack }));

    act(() => result.current.handlers.onPointerDown(pointer(8, 400, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(20, 200, 100)));
    act(() => result.current.handlers.onPointerUp(pointer(20, 200, 100)));

    expect(onBack).not.toHaveBeenCalled();
    expect(result.current.travel).toBe(0);
  });

  it("springs back when released short of the threshold", () => {
    setDirection("ltr");
    const onBack = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeBack({ enabled: true, onBack }));

    // Slow and short: neither the distance nor the velocity rule fires.
    act(() => result.current.handlers.onPointerDown(pointer(8, 400, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(40, 400, 900)));
    act(() => result.current.handlers.onPointerUp(pointer(40, 400, 900)));

    expect(onBack).not.toHaveBeenCalled();
    expect(result.current.travel).toBe(0);
  });
});
