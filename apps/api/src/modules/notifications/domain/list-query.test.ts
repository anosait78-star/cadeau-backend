import { describe, expect, it } from "vitest";
import { parseNotificationListQuery } from "./list-query";

describe("parseNotificationListQuery", () => {
  it("parses an empty query into defaults", () => {
    const { query, errors } = parseNotificationListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({});
  });

  it("parses limit, cursor, type, read, and date bounds", () => {
    const { query, errors } = parseNotificationListQuery({
      limit: "10",
      cursor: "abc",
      type: "order.status_changed",
      read: "true",
      createdAtFrom: "2026-01-01T00:00:00.000Z",
      createdAtTo: "2026-02-01T00:00:00.000Z",
    });
    expect(errors).toEqual([]);
    expect(query).toEqual({
      limit: 10,
      cursor: "abc",
      type: "order.status_changed",
      read: true,
      createdAtFrom: "2026-01-01T00:00:00.000Z",
      createdAtTo: "2026-02-01T00:00:00.000Z",
    });
  });

  it("rejects an unknown type", () => {
    const { query, errors } = parseNotificationListQuery({ type: "bogus" });
    expect(query).toBeUndefined();
    expect(errors).toEqual([
      { field: "type", messages: ["type must be a known notification type"] },
    ]);
  });

  it("rejects a non-boolean read value", () => {
    const { errors } = parseNotificationListQuery({ read: "maybe" });
    expect(errors).toEqual([{ field: "read", messages: ["read must be true or false"] }]);
  });

  it("parses read: false", () => {
    const { query } = parseNotificationListQuery({ read: "false" });
    expect(query?.read).toBe(false);
  });

  it("rejects invalid createdAtFrom/createdAtTo", () => {
    const { errors } = parseNotificationListQuery({
      createdAtFrom: "not-a-date",
      createdAtTo: "also-not-a-date",
    });
    expect(errors).toEqual([
      { field: "createdAtFrom", messages: ["createdAtFrom must be an ISO-8601 date-time"] },
      { field: "createdAtTo", messages: ["createdAtTo must be an ISO-8601 date-time"] },
    ]);
  });

  it("aggregates multiple errors", () => {
    const { errors } = parseNotificationListQuery({ type: "bogus", read: "maybe" });
    expect(errors).toHaveLength(2);
  });
});
