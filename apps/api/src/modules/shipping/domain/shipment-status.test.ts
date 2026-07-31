import { describe, expect, it } from "vitest";
import {
  canTransition,
  isShippableOrderStatus,
  isTerminal,
  isValidStatus,
  nextStates,
  SHIPMENT_STATUSES,
} from "./shipment-status";

describe("shipment state machine", () => {
  it("recognizes the 6 lifecycle states", () => {
    expect(SHIPMENT_STATUSES).toHaveLength(6);
    expect(isValidStatus("in_transit")).toBe(true);
    expect(isValidStatus("nope")).toBe(false);
  });

  it("allows only the default legal transitions", () => {
    expect(canTransition("created", "picked_up")).toBe(true);
    expect(canTransition("picked_up", "in_transit")).toBe(true);
    expect(canTransition("in_transit", "delivered")).toBe(true);
    // Illegal jumps.
    expect(canTransition("created", "delivered")).toBe(false);
    expect(canTransition("created", "in_transit")).toBe(false);
  });

  it("treats delivered, returned and cancelled as terminal", () => {
    expect(nextStates("delivered")).toHaveLength(0);
    expect(nextStates("returned")).toHaveLength(0);
    expect(nextStates("cancelled")).toHaveLength(0);
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("created")).toBe(false);
  });

  it("recognizes shippable order statuses", () => {
    expect(isShippableOrderStatus("ready")).toBe(true);
    expect(isShippableOrderStatus("shipped")).toBe(true);
    expect(isShippableOrderStatus("new")).toBe(false);
    expect(isShippableOrderStatus("delivered")).toBe(false);
  });
});
