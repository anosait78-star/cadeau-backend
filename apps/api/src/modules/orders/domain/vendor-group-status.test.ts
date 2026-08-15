import { describe, expect, it } from "vitest";
import {
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
