import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KPI_PERIODS, resolvePeriodWindow } from "./period-kpis";

/** A fixed "now" so every expectation below is about the maths, not the clock. */
const NOW = new Date(2026, 8, 15, 14, 30); // 15 September 2026, 14:30 local

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** Local calendar fields, since the windows are built in local time. */
function parts(iso: string) {
  const d = new Date(iso);
  return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate(), h: d.getHours() };
}

describe("resolvePeriodWindow", () => {
  it("starts today at midnight, not at the current time", () => {
    const window = resolvePeriodWindow("today");
    expect(parts(window.from!)).toEqual({ y: 2026, m: 8, day: 15, h: 0 });
    expect(window.to).toBeUndefined();
    expect(window.granularity).toBe("day");
  });

  it("starts this month on the first", () => {
    const window = resolvePeriodWindow("month");
    expect(parts(window.from!)).toEqual({ y: 2026, m: 8, day: 1, h: 0 });
    expect(window.to).toBeUndefined();
  });

  it("bounds last month at both ends so it cannot bleed into this one", () => {
    const window = resolvePeriodWindow("lastMonth");
    expect(parts(window.from!)).toEqual({ y: 2026, m: 7, day: 1, h: 0 });
    expect(parts(window.to!)).toEqual({ y: 2026, m: 8, day: 1, h: 0 });
  });

  it("goes back three months, bucketed by week", () => {
    const window = resolvePeriodWindow("quarter");
    expect(parts(window.from!)).toEqual({ y: 2026, m: 5, day: 15, h: 0 });
    expect(window.granularity).toBe("week");
  });

  it("goes back twelve months, bucketed by month", () => {
    const window = resolvePeriodWindow("year");
    expect(parts(window.from!)).toEqual({ y: 2025, m: 8, day: 15, h: 0 });
    expect(window.granularity).toBe("month");
  });

  it("leaves 'all time' unbounded rather than guessing an earliest date", () => {
    const window = resolvePeriodWindow("all");
    expect(window.from).toBeUndefined();
    expect(window.to).toBeUndefined();
  });

  it("produces a usable window for every period offered", () => {
    for (const period of KPI_PERIODS) {
      const window = resolvePeriodWindow(period);
      expect(window.granularity).toBeDefined();
      if (window.from !== undefined) expect(Number.isNaN(Date.parse(window.from))).toBe(false);
      if (window.to !== undefined) expect(Number.isNaN(Date.parse(window.to))).toBe(false);
    }
  });

  it("rolls the year back correctly when this month is January", () => {
    vi.setSystemTime(new Date(2026, 0, 10));
    const lastMonth = resolvePeriodWindow("lastMonth");
    expect(parts(lastMonth.from!)).toEqual({ y: 2025, m: 11, day: 1, h: 0 });
    expect(parts(lastMonth.to!)).toEqual({ y: 2026, m: 0, day: 1, h: 0 });
  });
});
