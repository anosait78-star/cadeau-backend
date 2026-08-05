import { describe, expect, it } from "vitest";
import { parseOrderListQuery } from "./list-query";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("parseOrderListQuery", () => {
  it("defaults to -createdAt", () => {
    const { query, errors } = parseOrderListQuery({});
    expect(errors).toHaveLength(0);
    expect(query?.sort).toEqual({ field: "createdAt", dir: "desc" });
  });

  it("accepts the whitelisted sorts and rejects others", () => {
    expect(parseOrderListQuery({ sort: "-updatedAt" }).query?.sort).toEqual({
      field: "updatedAt",
      dir: "desc",
    });
    const bad = parseOrderListQuery({ sort: "total" });
    expect(bad.query).toBeUndefined();
    expect(bad.errors[0]?.field).toBe("sort");
  });

  it("validates the status and follow-up enums", () => {
    expect(parseOrderListQuery({ status: "processing" }).query?.status).toBe("processing");
    expect(parseOrderListQuery({ status: "nope" }).errors[0]?.field).toBe("status");
    expect(parseOrderListQuery({ followUpState: "pending" }).query?.followUpState).toBe("pending");
    expect(parseOrderListQuery({ followUpState: "x" }).errors[0]?.field).toBe("followUpState");
  });

  it("validates uuid filters", () => {
    expect(parseOrderListQuery({ customerId: UUID }).query?.customerId).toBe(UUID);
    expect(parseOrderListQuery({ customerId: "nope" }).errors[0]?.field).toBe("customerId");
    expect(parseOrderListQuery({ assigneeId: "nope" }).errors[0]?.field).toBe("assigneeId");
  });

  it("routes an all-digits q to a number lookup, otherwise text", () => {
    expect(parseOrderListQuery({ q: "1042" }).query?.search).toEqual({
      kind: "number",
      value: 1042,
    });
    expect(parseOrderListQuery({ q: "Sara" }).query?.search).toEqual({
      kind: "text",
      term: "Sara",
    });
    expect(parseOrderListQuery({ q: "   " }).query?.search).toBeUndefined();
  });

  it("carries limit, cursor and every optional through to the parsed query", () => {
    const { query, errors } = parseOrderListQuery({
      limit: "50",
      cursor: "abc",
      labelId: UUID,
      reasonId: UUID,
      governorateId: UUID,
      createdAtTo: "2026-02-01T00:00:00Z",
    });
    expect(errors).toHaveLength(0);
    expect(query?.limit).toBe(50);
    expect(query?.cursor).toBe("abc");
    expect(query?.labelId).toBe(UUID);
    expect(query?.reasonId).toBe(UUID);
    expect(query?.governorateId).toBe(UUID);
    expect(query?.createdAtTo).toBe("2026-02-01T00:00:00.000Z");
  });

  it("validates date bounds", () => {
    expect(parseOrderListQuery({ createdAtFrom: "not-a-date" }).errors[0]?.field).toBe(
      "createdAtFrom",
    );
    const ok = parseOrderListQuery({ createdAtFrom: "2026-01-01T00:00:00Z" });
    expect(ok.errors).toHaveLength(0);
    expect(ok.query?.createdAtFrom).toBe("2026-01-01T00:00:00.000Z");
  });
});
