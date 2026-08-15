import { describe, expect, it } from "vitest";
import {
  aggregateVendorOrderStatus,
  canTransitionVendorGroup,
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

  it("allows only the single next step forward", () => {
    expect(canTransitionVendorGroup("new", "processing")).toBe(true);
    expect(canTransitionVendorGroup("processing", "ready")).toBe(true);
    expect(canTransitionVendorGroup("ready", "delivered")).toBe(true);
  });

  it("forbids skipping ahead", () => {
    expect(canTransitionVendorGroup("new", "ready")).toBe(false);
    expect(canTransitionVendorGroup("new", "delivered")).toBe(false);
    expect(canTransitionVendorGroup("processing", "delivered")).toBe(false);
  });

  it("forbids moving backward", () => {
    expect(canTransitionVendorGroup("processing", "new")).toBe(false);
    expect(canTransitionVendorGroup("ready", "processing")).toBe(false);
    expect(canTransitionVendorGroup("delivered", "ready")).toBe(false);
  });

  it("treats delivered as terminal", () => {
    expect(nextVendorGroupStates("delivered")).toHaveLength(0);
  });

  it("exposes exactly the next reachable state for each non-terminal status", () => {
    expect(nextVendorGroupStates("new")).toEqual(["processing"]);
    expect(nextVendorGroupStates("processing")).toEqual(["ready"]);
    expect(nextVendorGroupStates("ready")).toEqual(["delivered"]);
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
