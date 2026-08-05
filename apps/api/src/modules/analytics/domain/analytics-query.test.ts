import { describe, expect, it } from "vitest";
import { parseAnalyticsQuery, parseExportRequest, precedingWindow } from "./analytics-query";

describe("parseAnalyticsQuery", () => {
  it("defaults to the last 30 days and day granularity when nothing is given", () => {
    const { query, errors } = parseAnalyticsQuery({});
    expect(errors).toEqual([]);
    expect(query).toBeDefined();
    expect(query?.granularity).toBe("day");
    const spanMs = query!.to.getTime() - query!.from.getTime();
    expect(spanMs).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it("accepts an explicit from/to/granularity", () => {
    const { query, errors } = parseAnalyticsQuery({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
      granularity: "week",
    });
    expect(errors).toEqual([]);
    expect(query?.granularity).toBe("week");
    expect(query?.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(query?.to.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("rejects a malformed from date", () => {
    const { query, errors } = parseAnalyticsQuery({ from: "not-a-date" });
    expect(query).toBeUndefined();
    expect(errors).toEqual([{ field: "from", messages: ["from must be an ISO-8601 date-time"] }]);
  });

  it("rejects a malformed to date", () => {
    const { query, errors } = parseAnalyticsQuery({ to: "nope" });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("to");
  });

  it("rejects an invalid granularity", () => {
    const { query, errors } = parseAnalyticsQuery({ granularity: "year" });
    expect(query).toBeUndefined();
    expect(errors).toEqual([
      { field: "granularity", messages: ["granularity must be one of: day, week, month"] },
    ]);
  });

  it("rejects from after to", () => {
    const { query, errors } = parseAnalyticsQuery({
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-01-01T00:00:00.000Z",
    });
    expect(query).toBeUndefined();
    expect(errors).toEqual([{ field: "from", messages: ["from must not be after to"] }]);
  });
});

describe("precedingWindow", () => {
  it("returns the immediately preceding window of equal length", () => {
    const from = new Date("2026-01-11T00:00:00.000Z");
    const to = new Date("2026-01-21T00:00:00.000Z");
    const prev = precedingWindow(from, to);
    expect(prev.to.toISOString()).toBe(from.toISOString());
    expect(prev.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("parseExportRequest", () => {
  it("accepts a valid axis + window", () => {
    const { query, errors } = parseExportRequest({ axis: "business" });
    expect(errors).toEqual([]);
    expect(query?.axis).toBe("business");
  });

  it("rejects a missing axis", () => {
    const { query, errors } = parseExportRequest({});
    expect(query).toBeUndefined();
    expect(errors.some((e) => e.field === "axis")).toBe(true);
  });

  it("rejects an unknown axis", () => {
    const { query, errors } = parseExportRequest({ axis: "forecast" });
    expect(query).toBeUndefined();
    expect(errors.some((e) => e.field === "axis")).toBe(true);
  });

  it("propagates window errors alongside axis errors", () => {
    const { errors } = parseExportRequest({ axis: "nope", granularity: "year" });
    expect(errors.some((e) => e.field === "axis")).toBe(true);
    expect(errors.some((e) => e.field === "granularity")).toBe(true);
  });
});
