import { describe, expect, it } from "vitest";
import { InvalidCursorError } from "../errors";
import { buildKeysetPage, clampLimit, decodeCursor, encodeCursor } from "../keyset";

describe("clampLimit", () => {
  it("defaults when absent or invalid", () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(Number.NaN)).toBe(25);
    expect(clampLimit(0)).toBe(25);
    expect(clampLimit(-5)).toBe(25);
  });

  it("clamps to the ceiling and floors non-integers", () => {
    expect(clampLimit(1000)).toBe(100);
    expect(clampLimit(30.9)).toBe(30);
    expect(clampLimit(50)).toBe(50);
  });

  it("honours custom default and max", () => {
    expect(clampLimit(undefined, { defaultLimit: 10 })).toBe(10);
    expect(clampLimit(500, { maxLimit: 200 })).toBe(200);
  });
});

describe("cursor encode/decode", () => {
  it("round-trips sort-key values through an opaque token", () => {
    const values = { createdAt: "2026-07-28T00:00:00.000Z", id: "abc" };
    const cursor = encodeCursor(values);
    expect(cursor).not.toContain("{"); // opaque, not raw JSON
    expect(decodeCursor(cursor)).toEqual(values);
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeCursor("!!!not-base64-json")).toThrow(InvalidCursorError);
    expect(() => decodeCursor(encodeCursor([1, 2] as never))).toThrow(InvalidCursorError);
    // A base64url of a JSON array / non-object is rejected.
    const arrayToken = Buffer.from("[1,2]", "utf8").toString("base64url");
    expect(() => decodeCursor(arrayToken)).toThrow(InvalidCursorError);
    const nestedToken = Buffer.from(JSON.stringify({ a: { b: 1 } }), "utf8").toString("base64url");
    expect(() => decodeCursor(nestedToken)).toThrow(InvalidCursorError);
  });
});

describe("buildKeysetPage", () => {
  const toCursor = (row: { id: string }) => ({ id: row.id });

  it("reports another page when an extra row was fetched", () => {
    const rows = [{ id: "1" }, { id: "2" }, { id: "3" }]; // limit=2, +1 extra
    const page = buildKeysetPage(rows, 2, toCursor);
    expect(page.data.map((r) => r.id)).toEqual(["1", "2"]);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.limit).toBe(2);
    expect(page.page.nextCursor).toBe(encodeCursor({ id: "2" }));
    expect(decodeCursor(page.page.nextCursor!)).toEqual({ id: "2" });
  });

  it("is the last page when no extra row came back", () => {
    const page = buildKeysetPage([{ id: "1" }, { id: "2" }], 2, toCursor);
    expect(page.data).toHaveLength(2);
    expect(page.page.hasMore).toBe(false);
    expect(page.page.nextCursor).toBeNull();
  });

  it("handles an empty result", () => {
    const page = buildKeysetPage([], 25, toCursor);
    expect(page.data).toEqual([]);
    expect(page.page.hasMore).toBe(false);
    expect(page.page.nextCursor).toBeNull();
  });
});
