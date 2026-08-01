import { describe, expect, it } from "vitest";
import { computeNextAttempt, isRetryExhausted, MAX_ATTEMPTS } from "./delivery-retry-policy";

describe("delivery-retry-policy", () => {
  it("doubles the delay each attempt, capped at 1h", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(computeNextAttempt(1, now)).toEqual(new Date("2026-01-01T00:00:30.000Z"));
    expect(computeNextAttempt(2, now)).toEqual(new Date("2026-01-01T00:01:00.000Z"));
    expect(computeNextAttempt(3, now)).toEqual(new Date("2026-01-01T00:02:00.000Z"));
    expect(computeNextAttempt(8, now)).toEqual(new Date(now.getTime() + 60 * 60_000));
  });

  it("treats attempts=0 like attempts=1 (no negative exponent)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(computeNextAttempt(0, now)).toEqual(new Date("2026-01-01T00:00:30.000Z"));
  });

  it("returns null once the retry budget is exhausted", () => {
    expect(computeNextAttempt(MAX_ATTEMPTS)).toBeNull();
    expect(computeNextAttempt(MAX_ATTEMPTS + 5)).toBeNull();
  });

  it("isRetryExhausted matches the MAX_ATTEMPTS boundary", () => {
    expect(isRetryExhausted(MAX_ATTEMPTS - 1)).toBe(false);
    expect(isRetryExhausted(MAX_ATTEMPTS)).toBe(true);
  });
});
