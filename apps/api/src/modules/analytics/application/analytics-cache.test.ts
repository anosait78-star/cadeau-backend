import { describe, expect, it } from "vitest";
import type { Clock } from "../../../shared/time/clock";
import { AnalyticsCache, ANALYTICS_CACHE_TTL_MS } from "./analytics-cache";

function fakeClock(startMs: number): Clock & { advance: (ms: number) => void } {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("AnalyticsCache", () => {
  it("returns null for an absent key", () => {
    const cache = new AnalyticsCache(fakeClock(0));
    expect(cache.get("missing")).toBeNull();
  });

  it("returns a cached value before the TTL expires", () => {
    const clock = fakeClock(0);
    const cache = new AnalyticsCache(clock);
    cache.set("k", { a: 1 });
    clock.advance(ANALYTICS_CACHE_TTL_MS - 1);
    expect(cache.get("k")).toEqual({ a: 1 });
  });

  it("expires a cached value after the TTL", () => {
    const clock = fakeClock(0);
    const cache = new AnalyticsCache(clock);
    cache.set("k", { a: 1 });
    clock.advance(ANALYTICS_CACHE_TTL_MS + 1);
    expect(cache.get("k")).toBeNull();
  });

  it("builds a stable key from company/axis/window/granularity", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T00:00:00.000Z");
    const key1 = AnalyticsCache.key("company-1", "business", from, to, "day");
    const key2 = AnalyticsCache.key("company-1", "business", from, to, "day");
    const key3 = AnalyticsCache.key("company-1", "products", from, to, "day");
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("clears every entry", () => {
    const cache = new AnalyticsCache(fakeClock(0));
    cache.set("k1", 1);
    cache.set("k2", 2);
    cache.clear();
    expect(cache.get("k1")).toBeNull();
    expect(cache.get("k2")).toBeNull();
  });
});
