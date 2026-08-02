import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDataGridSelection } from "./use-data-grid-selection";

describe("useDataGridSelection", () => {
  it("toggles a single id", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => result.current.onToggle("a"));
    expect(result.current.selectedIds.has("a")).toBe(true);
    act(() => result.current.onToggle("a"));
    expect(result.current.selectedIds.has("a")).toBe(false);
  });

  it("selects all then clears all on toggleAll", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => result.current.onToggleAll(["a", "b", "c"]));
    expect(result.current.isAllSelected(["a", "b", "c"])).toBe(true);
    act(() => result.current.onToggleAll(["a", "b", "c"]));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("reports indeterminate when some but not all rows are selected", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => result.current.onToggle("a"));
    expect(result.current.isIndeterminate(["a", "b"])).toBe(true);
    expect(result.current.isAllSelected(["a", "b"])).toBe(false);
  });

  it("clears selection", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => result.current.onToggle("a"));
    act(() => result.current.clear());
    expect(result.current.selectedIds.size).toBe(0);
  });
});
