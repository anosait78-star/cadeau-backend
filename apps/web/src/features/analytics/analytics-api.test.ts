import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportAnalytics,
  getBusinessAnalytics,
  getInventoryAnalytics,
  getProductsAnalytics,
  getProfitabilityAnalytics,
  getStaffAnalytics,
} from "./analytics-api";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("analytics-api query building", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(json(200, {}));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests with no query string when no window is given", async () => {
    await getBusinessAnalytics();
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url.endsWith("/analytics/business")).toBe(true);
  });

  it("builds a query string from from/to/granularity", async () => {
    await getProductsAnalytics({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
      granularity: "week",
    });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("from=2026-01-01T00%3A00%3A00.000Z");
    expect(url).toContain("granularity=week");
  });

  it("calls the inventory endpoint", async () => {
    await getInventoryAnalytics();
    expect((fetchMock.mock.calls[0]![0] as string).endsWith("/analytics/inventory")).toBe(true);
  });

  it("calls the staff endpoint", async () => {
    await getStaffAnalytics();
    expect((fetchMock.mock.calls[0]![0] as string).endsWith("/analytics/staff")).toBe(true);
  });

  it("calls the profitability endpoint", async () => {
    await getProfitabilityAnalytics();
    expect((fetchMock.mock.calls[0]![0] as string).endsWith("/analytics/profitability")).toBe(true);
  });
});

describe("exportAnalytics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["a,b\r\n"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the axis + window and triggers a download", async () => {
    const clickSpy = vi.fn();
    const anchor = document.createElement("a");
    vi.spyOn(anchor, "click").mockImplementation(clickSpy);
    vi.spyOn(document, "createElement").mockReturnValueOnce(anchor);

    await exportAnalytics("business", { from: "2026-01-01T00:00:00.000Z" });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      axis: "business",
      from: "2026-01-01T00:00:00.000Z",
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("analytics-business.csv");
  });
});
