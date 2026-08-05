import { describe, expect, it } from "vitest";
import {
  canTransition,
  derivePaymentStatus,
  isConsistentPaymentStatus,
  isValidFollowUpState,
  isValidStatus,
  nextStates,
  ORDER_STATUSES,
  requiresReason,
  stockEffectOf,
} from "./order-status";

describe("order state machine", () => {
  it("recognizes the 12 lifecycle states", () => {
    expect(ORDER_STATUSES).toHaveLength(12);
    expect(isValidStatus("processing")).toBe(true);
    expect(isValidStatus("nope")).toBe(false);
  });

  it("recognizes follow-up states", () => {
    expect(isValidFollowUpState("none")).toBe(true);
    expect(isValidFollowUpState("no_answer")).toBe(true);
    expect(isValidFollowUpState("shipped")).toBe(false);
  });

  it("allows only the default legal transitions", () => {
    expect(canTransition("new", "processing")).toBe(true);
    expect(canTransition("ready", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("delivered", "completed")).toBe(true);
    // Illegal jumps.
    expect(canTransition("new", "delivered")).toBe(false);
    expect(canTransition("new", "completed")).toBe(false);
  });

  it("treats cancelled and exchanged as terminal", () => {
    expect(nextStates("cancelled")).toHaveLength(0);
    expect(nextStates("exchanged")).toHaveLength(0);
  });

  it("classifies stock side effects", () => {
    // Entering processing from a non-reserving state reserves.
    expect(stockEffectOf("confirming", "processing")).toBe("reserve");
    expect(stockEffectOf("new", "processing")).toBe("reserve");
    // Moving between reserving states does NOT re-reserve.
    expect(stockEffectOf("postponed", "processing")).toBe("none");
    // Shipping decrements on-hand.
    expect(stockEffectOf("ready", "shipped")).toBe("ship");
    // Pre-ship cancel/return releases the held reservation.
    expect(stockEffectOf("processing", "cancelled")).toBe("release");
    expect(stockEffectOf("ready", "returned")).toBe("release");
    // Cancelling a fresh order holds nothing to release.
    expect(stockEffectOf("new", "cancelled")).toBe("none");
  });

  it("requires a reason only for cancel", () => {
    expect(requiresReason("cancelled")).toBe(true);
    expect(requiresReason("processing")).toBe(false);
  });

  it("derives the payment status from collected vs total", () => {
    expect(derivePaymentStatus(0, 1000)).toBe("unpaid");
    expect(derivePaymentStatus(400, 1000)).toBe("partial");
    expect(derivePaymentStatus(1000, 1000)).toBe("paid");
    expect(derivePaymentStatus(1200, 1000)).toBe("paid");
  });

  describe("isConsistentPaymentStatus", () => {
    it("accepts each status paired with a matching collectedAmount", () => {
      expect(isConsistentPaymentStatus("unpaid", 0, 1000)).toBe(true);
      expect(isConsistentPaymentStatus("partial", 400, 1000)).toBe(true);
      expect(isConsistentPaymentStatus("paid", 1000, 1000)).toBe(true);
    });

    it("rejects a status that doesn't match the derived one", () => {
      expect(isConsistentPaymentStatus("paid", 400, 1000)).toBe(false);
      expect(isConsistentPaymentStatus("unpaid", 400, 1000)).toBe(false);
      expect(isConsistentPaymentStatus("partial", 0, 1000)).toBe(false);
      expect(isConsistentPaymentStatus("partial", 1000, 1000)).toBe(false);
    });
  });
});
