import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "./use-long-press";

/** A pointer event with only the fields the hook reads. */
function pointer(over: Partial<{ clientX: number; clientY: number; button: number }> = {}) {
  return {
    clientX: 0,
    clientY: 0,
    button: 0,
    pointerType: "touch",
    ...over,
  } as unknown as Parameters<ReturnType<typeof useLongPress>["onPointerDown"]>[0];
}

describe("useLongPress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fires once the press has been held long enough", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(600));

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(result.current.pressWasLong()).toBe(true);
  });

  it("does not fire when the press is released early", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(200));
    act(() => result.current.onPointerUp());
    act(() => void vi.advanceTimersByTime(600));

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does not fire when the finger drags — that is a scroll, not a press", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => result.current.onPointerMove(pointer({ clientY: 40 })));
    act(() => void vi.advanceTimersByTime(600));

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("tolerates the small drift of a finger held still", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => result.current.onPointerMove(pointer({ clientX: 4, clientY: 3 })));
    act(() => void vi.advanceTimersByTime(600));

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("stays inert when disabled", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, { enabled: false }));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(600));

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("suppresses the OS context menu only while enabled", () => {
    const enabled = renderHook(() => useLongPress(vi.fn()));
    const disabled = renderHook(() => useLongPress(vi.fn(), { enabled: false }));

    const on = { preventDefault: vi.fn() };
    const off = { preventDefault: vi.fn() };
    enabled.result.current.onContextMenu(on);
    disabled.result.current.onContextMenu(off);

    // Otherwise iOS's selection callout lands on top of the selection.
    expect(on.preventDefault).toHaveBeenCalled();
    expect(off.preventDefault).not.toHaveBeenCalled();
  });
});
