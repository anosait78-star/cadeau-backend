import { act, renderHook } from "@testing-library/react";
import type { TouchEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSwipe } from "./use-swipe";

function touch(x: number, y: number): TouchEvent {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as TouchEvent;
}

describe("useSwipe", () => {
  it("detects a downward swipe past the threshold", () => {
    const onSwipeDown = vi.fn();
    const { result } = renderHook(() => useSwipe({ onSwipeDown, threshold: 50 }));
    act(() => {
      result.current.onTouchStart(touch(100, 100));
      result.current.onTouchMove(touch(105, 200));
      result.current.onTouchEnd();
    });
    expect(onSwipeDown).toHaveBeenCalledOnce();
  });

  it("resolves the dominant axis (horizontal) and reports the direction", () => {
    const onSwipe = vi.fn();
    const onSwipeLeft = vi.fn();
    const { result } = renderHook(() => useSwipe({ onSwipe, onSwipeLeft, threshold: 50 }));
    act(() => {
      result.current.onTouchStart(touch(200, 100));
      result.current.onTouchMove(touch(80, 115));
      result.current.onTouchEnd();
    });
    expect(onSwipe).toHaveBeenCalledWith("left");
    expect(onSwipeLeft).toHaveBeenCalledOnce();
  });

  it("ignores sub-threshold moves", () => {
    const onSwipeDown = vi.fn();
    const { result } = renderHook(() => useSwipe({ onSwipeDown, threshold: 50 }));
    act(() => {
      result.current.onTouchStart(touch(100, 100));
      result.current.onTouchMove(touch(110, 120));
      result.current.onTouchEnd();
    });
    expect(onSwipeDown).not.toHaveBeenCalled();
  });
});
