import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDragDismiss } from "./use-drag-dismiss";

/** A pointer event shaped the way the hook reads it, over a 200px-tall sheet. */
function pointer(y: number, time = 0, scrollTop = 0) {
  return {
    pointerType: "touch",
    clientY: y,
    timeStamp: time,
    pointerId: 1,
    currentTarget: {
      scrollTop,
      getBoundingClientRect: () => ({ height: 200 }),
      releasePointerCapture: () => undefined,
    },
  } as unknown as React.PointerEvent<HTMLElement>;
}

describe("useDragDismiss", () => {
  it("follows the finger downward", () => {
    const { result } = renderHook(() => useDragDismiss(vi.fn()));

    act(() => result.current.handlers.onPointerDown(pointer(100)));
    act(() => result.current.handlers.onPointerMove(pointer(160)));

    expect(result.current.offset).toBe(60);
    expect(result.current.dragging).toBe(true);
  });

  it("resists an upward drag instead of ignoring it", () => {
    const { result } = renderHook(() => useDragDismiss(vi.fn()));

    act(() => result.current.handlers.onPointerDown(pointer(200)));
    act(() => result.current.handlers.onPointerMove(pointer(100)));

    // Some give, but far less than the 100px the finger travelled.
    expect(result.current.offset).toBeLessThan(0);
    expect(result.current.offset).toBeGreaterThan(-100);
  });

  it("dismisses when dragged past a quarter of its height", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDragDismiss(onDismiss));

    // 60px of a 200px sheet, taken slowly so only the distance rule can fire.
    act(() => result.current.handlers.onPointerDown(pointer(100, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(160, 900)));
    act(() => result.current.handlers.onPointerUp(pointer(160, 900)));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(result.current.offset).toBe(0);
  });

  it("dismisses on a flick that never travels far", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDragDismiss(onDismiss));

    // 40px in 20ms: under the distance threshold, over the velocity one.
    act(() => result.current.handlers.onPointerDown(pointer(100, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(140, 20)));
    act(() => result.current.handlers.onPointerUp(pointer(140, 20)));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("springs back from a short, slow drag", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDragDismiss(onDismiss));

    act(() => result.current.handlers.onPointerDown(pointer(100, 0)));
    act(() => result.current.handlers.onPointerMove(pointer(120, 900)));
    act(() => result.current.handlers.onPointerUp(pointer(120, 900)));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(result.current.offset).toBe(0);
  });

  it("leaves a scrolled sheet's content to scroll", () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useDragDismiss(onDismiss));

    act(() => result.current.handlers.onPointerDown(pointer(100, 0, 120)));
    act(() => result.current.handlers.onPointerMove(pointer(400, 40, 120)));

    expect(result.current.offset).toBe(0);
    expect(result.current.dragging).toBe(false);
  });

  it("ignores a mouse drag", () => {
    const { result } = renderHook(() => useDragDismiss(vi.fn()));
    const mouse = { ...pointer(100), pointerType: "mouse" } as React.PointerEvent<HTMLElement>;

    act(() => result.current.handlers.onPointerDown(mouse));
    act(() => result.current.handlers.onPointerMove(pointer(300)));

    expect(result.current.offset).toBe(0);
  });
});
