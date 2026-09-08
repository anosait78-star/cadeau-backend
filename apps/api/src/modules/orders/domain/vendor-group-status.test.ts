import { describe, expect, it } from "vitest";
import {
  aggregateVendorOrderStatus,
  canOverrideVendorGroupStatus,
  canVendorAdvance,
  isValidVendorGroupStatus,
  nextVendorGroupStates,
  VENDOR_GROUP_STATUSES,
} from "./vendor-group-status";

describe("vendor group status machine (Vendor Accounts, Phase 3)", () => {
  it("recognizes the 4 lifecycle states", () => {
    expect(VENDOR_GROUP_STATUSES).toHaveLength(4);
    expect(isValidVendorGroupStatus("processing")).toBe(true);
    expect(isValidVendorGroupStatus("nope")).toBe(false);
  });

  it("lets a vendor take the next step forward", () => {
    expect(canVendorAdvance("new", "processing")).toBe(true);
    expect(canVendorAdvance("processing", "ready")).toBe(true);
    expect(canVendorAdvance("ready", "delivered")).toBe(true);
  });

  it("lets a vendor skip ahead any distance", () => {
    expect(canVendorAdvance("new", "ready")).toBe(true);
    expect(canVendorAdvance("new", "delivered")).toBe(true);
    expect(canVendorAdvance("processing", "delivered")).toBe(true);
  });

  it("forbids a vendor from moving backward", () => {
    expect(canVendorAdvance("processing", "new")).toBe(false);
    expect(canVendorAdvance("ready", "processing")).toBe(false);
    expect(canVendorAdvance("delivered", "new")).toBe(false);
  });

  it("forbids a vendor from re-setting the status it is already in", () => {
    for (const status of VENDOR_GROUP_STATUSES) {
      expect(canVendorAdvance(status, status)).toBe(false);
    }
  });

  it("treats delivered as terminal for a vendor", () => {
    expect(nextVendorGroupStates("delivered")).toHaveLength(0);
  });

  it("exposes every forward state a vendor may drop onto", () => {
    expect(nextVendorGroupStates("new")).toEqual(["processing", "ready", "delivered"]);
    expect(nextVendorGroupStates("processing")).toEqual(["ready", "delivered"]);
    expect(nextVendorGroupStates("ready")).toEqual(["delivered"]);
  });

  it("lets a manager override in either direction", () => {
    expect(canOverrideVendorGroupStatus("delivered", "new")).toBe(true);
    expect(canOverrideVendorGroupStatus("ready", "processing")).toBe(true);
    expect(canOverrideVendorGroupStatus("new", "delivered")).toBe(true);
  });

  it("rejects a manager override that changes nothing", () => {
    for (const status of VENDOR_GROUP_STATUSES) {
      expect(canOverrideVendorGroupStatus(status, status)).toBe(false);
    }
  });
});

describe("aggregateVendorOrderStatus (Vendor Accounts, Phase 8)", () => {
  it("is null for an order with no vendor groups (non-multi-vendor)", () => {
    expect(aggregateVendorOrderStatus([])).toBeNull();
  });

  it("is the single group's own status when there is only one vendor", () => {
    expect(aggregateVendorOrderStatus([{ status: "ready" }])).toBe("ready");
  });

  it("is delivered only when every group is delivered", () => {
    expect(aggregateVendorOrderStatus([{ status: "delivered" }, { status: "delivered" }])).toBe(
      "delivered",
    );
  });

  it("matches the spec's worked example: 4 delivered + 1 new aggregates to new", () => {
    expect(
      aggregateVendorOrderStatus([
        { status: "delivered" },
        { status: "delivered" },
        { status: "ready" },
        { status: "processing" },
        { status: "new" },
      ]),
    ).toBe("new");
  });

  it("picks the least-advanced status regardless of array order", () => {
    expect(aggregateVendorOrderStatus([{ status: "ready" }, { status: "processing" }])).toBe(
      "processing",
    );
  });

  it("ignores rows in an unrecognized status defensively, rather than throwing", () => {
    expect(aggregateVendorOrderStatus([{ status: "bogus" }])).toBeNull();
    expect(aggregateVendorOrderStatus([{ status: "bogus" }, { status: "ready" }])).toBe("ready");
  });
});
