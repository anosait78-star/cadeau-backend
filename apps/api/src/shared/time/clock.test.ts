import { describe, expect, it } from "vitest";
import { type Clock, systemClockProvider } from "./clock";

describe("systemClockProvider", () => {
  it("returns the current wall-clock time in milliseconds", () => {
    const clock = (systemClockProvider as { useValue: Clock }).useValue;
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
