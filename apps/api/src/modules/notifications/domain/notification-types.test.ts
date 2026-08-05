import { describe, expect, it } from "vitest";
import { isNotificationType, NOTIFICATION_TYPES } from "./notification-types";

describe("isNotificationType", () => {
  it("accepts every catalog type", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(isNotificationType(type)).toBe(true);
    }
  });

  it("rejects an unknown string", () => {
    expect(isNotificationType("stock.low")).toBe(false);
    expect(isNotificationType("")).toBe(false);
  });
});
