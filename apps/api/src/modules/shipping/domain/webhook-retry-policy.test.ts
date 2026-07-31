import { describe, expect, it } from "vitest";
import { computeNextAttempt, isRetryExhausted, MAX_ATTEMPTS } from "./webhook-retry-policy";

describe("webhook retry/backoff policy", () => {
  it("doubles the delay each attempt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = computeNextAttempt(1, now);
    const second = computeNextAttempt(2, now);
    const third = computeNextAttempt(3, now);
    expect(first?.getTime()).toBe(now.getTime() + 30_000);
    expect(second?.getTime()).toBe(now.getTime() + 60_000);
    expect(third?.getTime()).toBe(now.getTime() + 120_000);
  });

  it("caps the delay at 1 hour", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const late = computeNextAttempt(MAX_ATTEMPTS - 1, now);
    expect(late?.getTime()).toBe(now.getTime() + 60 * 60_000);
  });

  it("parks the event (returns null) once the retry budget is exhausted", () => {
    expect(isRetryExhausted(MAX_ATTEMPTS)).toBe(true);
    expect(isRetryExhausted(MAX_ATTEMPTS - 1)).toBe(false);
    expect(computeNextAttempt(MAX_ATTEMPTS)).toBeNull();
    expect(computeNextAttempt(MAX_ATTEMPTS + 5)).toBeNull();
  });
});
