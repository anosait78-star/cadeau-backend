import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../../shared/time/clock";
import type { ResourceView } from "../domain/resource.types";
import { MASTER_DATA_TTL_MS, MasterDataCache } from "./master-data-cache";

function view(id: string): ResourceView {
  return {
    id,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("MasterDataCache", () => {
  let now = 1_000;
  const clock: Clock = { now: () => now };
  let cache: MasterDataCache;

  beforeEach(() => {
    now = 1_000;
    cache = new MasterDataCache(clock);
  });

  it("returns null on a miss", () => {
    expect(cache.get("units", "co")).toBeNull();
  });

  it("returns a set within its TTL", () => {
    cache.set("units", "co", [view("a")]);
    expect(cache.get("units", "co")).toEqual([view("a")]);
  });

  it("expires after the TTL", () => {
    cache.set("units", "co", [view("a")]);
    now += MASTER_DATA_TTL_MS + 1;
    expect(cache.get("units", "co")).toBeNull();
  });

  it("isolates scopes and resources", () => {
    cache.set("units", "co1", [view("a")]);
    expect(cache.get("units", "co2")).toBeNull();
    expect(cache.get("order-labels", "co1")).toBeNull();
  });

  it("invalidates one entry", () => {
    cache.set("units", "co", [view("a")]);
    cache.invalidate("units", "co");
    expect(cache.get("units", "co")).toBeNull();
  });

  it("clears everything", () => {
    cache.set("units", "co", [view("a")]);
    cache.set("order-labels", "co", [view("b")]);
    cache.clear();
    expect(cache.get("units", "co")).toBeNull();
    expect(cache.get("order-labels", "co")).toBeNull();
  });
});
