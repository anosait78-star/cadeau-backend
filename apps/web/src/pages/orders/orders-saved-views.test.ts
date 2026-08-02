import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { builtInViews, useSavedViews } from "./orders-saved-views";

describe("builtInViews", () => {
  it("maps My Orders to assigneeId when a user id is given", () => {
    const views = builtInViews("u1");
    expect(views.find((v) => v.id === "mine")?.filters).toEqual({ assigneeId: "u1" });
  });

  it("maps Late to the existing followUpState filter", () => {
    const views = builtInViews(null);
    expect(views.find((v) => v.id === "late")?.filters).toEqual({ followUpState: "no_answer" });
  });
});

describe("useSavedViews", () => {
  beforeEach(() => window.localStorage.clear());

  it("saves and round-trips a custom view via localStorage", () => {
    const { result, rerender } = renderHook(() => useSavedViews("u1"));
    act(() => result.current.save("My VIPs", { labelId: "l1" }));
    expect(result.current.customViews).toHaveLength(1);
    expect(result.current.customViews[0]?.name).toBe("My VIPs");

    rerender();
    const { result: reloaded } = renderHook(() => useSavedViews("u1"));
    expect(reloaded.current.customViews).toHaveLength(1);
  });

  it("removes a custom view", () => {
    const { result } = renderHook(() => useSavedViews("u1"));
    act(() => result.current.save("Temp", {}));
    const id = result.current.customViews[0]?.id as string;
    act(() => result.current.remove(id));
    expect(result.current.customViews).toHaveLength(0);
  });

  it("keeps views scoped per user", () => {
    const { result: u1 } = renderHook(() => useSavedViews("u1"));
    act(() => u1.current.save("U1 view", {}));
    const { result: u2 } = renderHook(() => useSavedViews("u2"));
    expect(u2.current.customViews).toHaveLength(0);
  });
});
