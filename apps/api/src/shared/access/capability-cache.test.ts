import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../time/clock";
import { CAPABILITY_TTL_MS, CapabilityCache } from "./capability-cache";
import type { EffectiveCapabilities } from "./capabilities";

const CAPS: EffectiveCapabilities = { features: ["orders"], permissions: ["orders.read"] };

/** A controllable clock for deterministic TTL tests. */
class FakeClock implements Clock {
  constructor(public time = 1_000) {}
  now(): number {
    return this.time;
  }
}

describe("CapabilityCache", () => {
  let clock: FakeClock;
  let cache: CapabilityCache;

  beforeEach(() => {
    clock = new FakeClock();
    cache = new CapabilityCache(clock);
  });

  it("returns null on a miss and the value on a hit", () => {
    expect(cache.get("c1", "u1")).toBeNull();
    cache.set("c1", "u1", CAPS);
    expect(cache.get("c1", "u1")).toEqual(CAPS);
  });

  it("expires an entry after the TTL", () => {
    cache.set("c1", "u1", CAPS);
    clock.time += CAPABILITY_TTL_MS - 1;
    expect(cache.get("c1", "u1")).toEqual(CAPS);
    clock.time += 1;
    expect(cache.get("c1", "u1")).toBeNull();
  });

  it("invalidates a single member without touching others", () => {
    cache.set("c1", "u1", CAPS);
    cache.set("c1", "u2", CAPS);
    cache.invalidateMember("c1", "u1");
    expect(cache.get("c1", "u1")).toBeNull();
    expect(cache.get("c1", "u2")).toEqual(CAPS);
  });

  it("invalidates every member of a company, not other companies", () => {
    cache.set("c1", "u1", CAPS);
    cache.set("c1", "u2", CAPS);
    cache.set("c2", "u1", CAPS);
    cache.invalidateCompany("c1");
    expect(cache.get("c1", "u1")).toBeNull();
    expect(cache.get("c1", "u2")).toBeNull();
    expect(cache.get("c2", "u1")).toEqual(CAPS);
  });
});
