import { describe, expect, it } from "vitest";
import { getRequestContext, getRequestId, runWithRequestContext } from "./request-context";

describe("request-context", () => {
  it("returns undefined outside of any request context", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it("exposes the bound context inside runWithRequestContext", () => {
    const result = runWithRequestContext({ requestId: "req-123" }, () => {
      expect(getRequestContext()).toEqual({ requestId: "req-123" });
      expect(getRequestId()).toBe("req-123");
      return "value";
    });
    expect(result).toBe("value");
  });

  it("does not leak context after the callback returns", () => {
    runWithRequestContext({ requestId: "req-abc" }, () => undefined);
    expect(getRequestId()).toBeUndefined();
  });

  it("isolates nested contexts", () => {
    runWithRequestContext({ requestId: "outer" }, () => {
      runWithRequestContext({ requestId: "inner" }, () => {
        expect(getRequestId()).toBe("inner");
      });
      expect(getRequestId()).toBe("outer");
    });
  });
});
