import { describe, expect, it } from "vitest";
import {
  parseInvoiceListQuery,
  parsePurchaseOrderListQuery,
  parseRefundListQuery,
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
