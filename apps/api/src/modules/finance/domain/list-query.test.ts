import { describe, expect, it } from "vitest";
import {
  parseExpenseListQuery,
  parseInvoiceListQuery,
  parsePurchaseOrderListQuery,
  parseReconciliationListQuery,
  parseRefundListQuery,
  parseReportRangeQuery,
  parseSupplierListQuery,
} from "./list-query";

describe("parseSupplierListQuery", () => {
  it("defaults to newest-first, active-only", () => {
    const { query, errors } = parseSupplierListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "createdAt", dir: "desc" }, active: true });
  });

  it("accepts an ascending whitelisted sort", () => {
    expect(parseSupplierListQuery({ sort: "name" }).query?.sort).toEqual({
      field: "name",
      dir: "asc",
    });
  });

  it("rejects a sort field outside the whitelist", () => {
    const { query, errors } = parseSupplierListQuery({ sort: "-taxId" });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("sort");
  });

  it("parses the active tri-state and rejects anything else", () => {
    expect(parseSupplierListQuery({ active: "true" }).query?.active).toBe(true);
    expect(parseSupplierListQuery({ active: "false" }).query?.active).toBe(false);
    expect(parseSupplierListQuery({ active: "all" }).query?.active).toBe("all");
    expect(parseSupplierListQuery({ active: "yes" }).errors[0]?.field).toBe("active");
  });

  it("trims a search term and drops it when empty", () => {
    expect(parseSupplierListQuery({ q: "  acme  " }).query?.q).toBe("acme");
    expect(parseSupplierListQuery({ q: "   " }).query).not.toHaveProperty("q");
  });

  it("passes limit and cursor through", () => {
    const { query } = parseSupplierListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });
});

describe("parsePurchaseOrderListQuery", () => {
  const SUPPLIER = "11111111-1111-1111-1111-111111111111";

  it("defaults to newest-first, no filters", () => {
    const { query, errors } = parsePurchaseOrderListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "createdAt", dir: "desc" } });
  });

  it("rejects a sort field outside the whitelist", () => {
    expect(parsePurchaseOrderListQuery({ sort: "number" }).errors[0]?.field).toBe("sort");
  });

  it("accepts a whitelisted status filter and rejects an unknown one", () => {
    expect(parsePurchaseOrderListQuery({ status: "ordered" }).query?.status).toBe("ordered");
    expect(parsePurchaseOrderListQuery({ status: "bogus" }).errors[0]?.field).toBe("status");
  });

  it("accepts a uuid supplierId filter and rejects a malformed one", () => {
    expect(parsePurchaseOrderListQuery({ supplierId: SUPPLIER }).query?.supplierId).toBe(SUPPLIER);
    expect(parsePurchaseOrderListQuery({ supplierId: "nope" }).errors[0]?.field).toBe("supplierId");
  });

  it("accepts ISO date-time range filters and rejects malformed ones", () => {
    const good = parsePurchaseOrderListQuery({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-02-01T00:00:00.000Z",
    });
    expect(good.query?.dateFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(good.query?.dateTo).toBe("2026-02-01T00:00:00.000Z");
    const bad = parsePurchaseOrderListQuery({ dateFrom: "not-a-date" });
    expect(bad.errors[0]?.field).toBe("dateFrom");
  });

  it("reports every problem at once", () => {
    const { query, errors } = parsePurchaseOrderListQuery({ sort: "bogus", status: "nope" });
    expect(query).toBeUndefined();
    expect(errors.map((e) => e.field)).toEqual(["sort", "status"]);
  });

  it("passes limit and cursor through", () => {
    const { query } = parsePurchaseOrderListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });
});

describe("parseInvoiceListQuery", () => {
  const ORDER = "22222222-2222-2222-2222-222222222222";

  it("defaults to newest-first, no filters", () => {
    const { query, errors } = parseInvoiceListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "createdAt", dir: "desc" } });
  });

  it("accepts a uuid orderId filter and rejects a malformed one", () => {
    expect(parseInvoiceListQuery({ orderId: ORDER }).query?.orderId).toBe(ORDER);
    expect(parseInvoiceListQuery({ orderId: "nope" }).errors[0]?.field).toBe("orderId");
  });

  it("accepts ISO date-time range filters and rejects malformed ones", () => {
    const good = parseInvoiceListQuery({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-02-01T00:00:00.000Z",
    });
    expect(good.query?.dateFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(good.query?.dateTo).toBe("2026-02-01T00:00:00.000Z");
    const bad = parseInvoiceListQuery({ dateTo: "not-a-date" });
    expect(bad.errors[0]?.field).toBe("dateTo");
  });

  it("passes limit and cursor through", () => {
    const { query } = parseInvoiceListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });
});

describe("parseRefundListQuery", () => {
  const INVOICE = "33333333-3333-3333-3333-333333333333";
  const ORDER = "44444444-4444-4444-4444-444444444444";

  it("defaults to newest-first, no filters", () => {
    const { query, errors } = parseRefundListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "createdAt", dir: "desc" } });
  });

  it("accepts uuid invoiceId/orderId filters and rejects malformed ones", () => {
    expect(parseRefundListQuery({ invoiceId: INVOICE }).query?.invoiceId).toBe(INVOICE);
    expect(parseRefundListQuery({ orderId: ORDER }).query?.orderId).toBe(ORDER);
    expect(parseRefundListQuery({ invoiceId: "nope" }).errors[0]?.field).toBe("invoiceId");
    expect(parseRefundListQuery({ orderId: "nope" }).errors[0]?.field).toBe("orderId");
  });

  it("accepts ISO date-time range filters and rejects malformed ones", () => {
    const good = parseRefundListQuery({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-02-01T00:00:00.000Z",
    });
    expect(good.query?.dateFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(good.query?.dateTo).toBe("2026-02-01T00:00:00.000Z");
    const bad = parseRefundListQuery({ dateFrom: "not-a-date" });
    expect(bad.errors[0]?.field).toBe("dateFrom");
  });

  it("passes limit and cursor through", () => {
    const { query } = parseRefundListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });
});

describe("parseExpenseListQuery", () => {
  const SUPPLIER = "55555555-5555-5555-5555-555555555555";

  it("defaults to newest-first, no filters", () => {
    const { query, errors } = parseExpenseListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "incurredAt", dir: "desc" } });
  });

  it("rejects a sort field outside the whitelist", () => {
    expect(parseExpenseListQuery({ sort: "amountMinor" }).errors[0]?.field).toBe("sort");
  });

  it("accepts a uuid supplierId filter and rejects a malformed one", () => {
    expect(parseExpenseListQuery({ supplierId: SUPPLIER }).query?.supplierId).toBe(SUPPLIER);
    expect(parseExpenseListQuery({ supplierId: "nope" }).errors[0]?.field).toBe("supplierId");
  });

  it("accepts ISO date-time range filters and rejects malformed ones", () => {
    const good = parseExpenseListQuery({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-02-01T00:00:00.000Z",
    });
    expect(good.query?.dateFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(good.query?.dateTo).toBe("2026-02-01T00:00:00.000Z");
    const bad = parseExpenseListQuery({ dateTo: "not-a-date" });
    expect(bad.errors[0]?.field).toBe("dateTo");
  });

  it("trims a category filter and drops it when empty", () => {
    expect(parseExpenseListQuery({ category: "  travel  " }).query?.category).toBe("travel");
    expect(parseExpenseListQuery({ category: "   " }).query).not.toHaveProperty("category");
  });

  it("passes limit and cursor through", () => {
    const { query } = parseExpenseListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });
});

describe("parseReconciliationListQuery", () => {
  it("defaults to newest-first, no filters", () => {
    const { query, errors } = parseReconciliationListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "createdAt", dir: "desc" } });
  });

  it("trims a carrier filter and drops it when empty", () => {
    expect(parseReconciliationListQuery({ carrier: "  manual  " }).query?.carrier).toBe("manual");
    expect(parseReconciliationListQuery({ carrier: "   " }).query).not.toHaveProperty("carrier");
  });

  it("accepts a well-formed periodKey and rejects a malformed one", () => {
    expect(parseReconciliationListQuery({ periodKey: "2026-01" }).query?.periodKey).toBe("2026-01");
    expect(parseReconciliationListQuery({ periodKey: "bogus" }).errors[0]?.field).toBe("periodKey");
  });

  it("passes limit and cursor through", () => {
    const { query } = parseReconciliationListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });
});

describe("parseReportRangeQuery", () => {
  it("requires dateFrom and dateTo", () => {
    expect(parseReportRangeQuery({}).errors.map((e) => e.field)).toEqual(["dateFrom", "dateTo"]);
    expect(
      parseReportRangeQuery({ dateFrom: "2026-01-01T00:00:00.000Z" }).errors.map((e) => e.field),
    ).toEqual(["dateTo"]);
  });

  it("rejects a malformed dateFrom/dateTo", () => {
    expect(
      parseReportRangeQuery({ dateFrom: "not-a-date", dateTo: "2026-01-31T00:00:00.000Z" })
        .errors[0]?.field,
    ).toBe("dateFrom");
    expect(
      parseReportRangeQuery({ dateFrom: "2026-01-01T00:00:00.000Z", dateTo: "not-a-date" })
        .errors[0]?.field,
    ).toBe("dateTo");
  });

  it("rejects a malformed compareFrom/compareTo", () => {
    const { errors } = parseReportRangeQuery({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
      compareFrom: "not-a-date",
      compareTo: "2025-12-31T00:00:00.000Z",
    });
    expect(errors.map((e) => e.field)).toContain("compareFrom");
  });

  it("requires compareFrom and compareTo together", () => {
    expect(
      parseReportRangeQuery({
        dateFrom: "2026-01-01T00:00:00.000Z",
        dateTo: "2026-01-31T00:00:00.000Z",
        compareFrom: "2025-12-01T00:00:00.000Z",
      }).errors[0]?.field,
    ).toBe("compareFrom");
    expect(
      parseReportRangeQuery({
        dateFrom: "2026-01-01T00:00:00.000Z",
        dateTo: "2026-01-31T00:00:00.000Z",
        compareTo: "2025-12-31T00:00:00.000Z",
      }).errors[0]?.field,
    ).toBe("compareFrom");
  });

  it("accepts a valid range with a comparison period", () => {
    const { query, errors } = parseReportRangeQuery({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
      compareFrom: "2025-12-01T00:00:00.000Z",
      compareTo: "2025-12-31T00:00:00.000Z",
    });
    expect(errors).toEqual([]);
    expect(query).toEqual({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
      compareFrom: "2025-12-01T00:00:00.000Z",
      compareTo: "2025-12-31T00:00:00.000Z",
    });
  });

  it("accepts a valid range without a comparison period", () => {
    const { query, errors } = parseReportRangeQuery({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
    });
    expect(errors).toEqual([]);
    expect(query).toEqual({
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
    });
  });
});
