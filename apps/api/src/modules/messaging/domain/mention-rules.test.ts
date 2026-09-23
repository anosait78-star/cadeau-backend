import { describe, expect, it } from "vitest";
import { MAX_MENTION_QUERY_LENGTH, parseMentionQuery, rejectedOrderIds } from "./mention-rules";

describe("parseMentionQuery", () => {
  it("lists recent orders when nothing has been typed yet", () => {
    expect(parseMentionQuery("")).toEqual({ kind: "all" });
    expect(parseMentionQuery(undefined)).toEqual({ kind: "all" });
    expect(parseMentionQuery("   ")).toEqual({ kind: "all" });
  });

  it("reads a digits-only query as an order number", () => {
    expect(parseMentionQuery("1023")).toEqual({ kind: "number", orderNumber: "1023" });
  });

  // Order numbers are displayed with a `#`, so typing `@#1023` is natural.
  it("strips the hash people type in front of an order number", () => {
    expect(parseMentionQuery("#1023")).toEqual({ kind: "number", orderNumber: "1023" });
    expect(parseMentionQuery("  #1023 ")).toEqual({ kind: "number", orderNumber: "1023" });
  });

  it("falls back to a text search for anything else", () => {
    expect(parseMentionQuery("سارة")).toEqual({ kind: "text", text: "سارة" });
    expect(parseMentionQuery("12ab")).toEqual({ kind: "text", text: "12ab" });
  });

  it("caps a pasted query rather than passing it through", () => {
    const long = "a".repeat(MAX_MENTION_QUERY_LENGTH + 50);
    const parsed = parseMentionQuery(long);
    expect(parsed).toMatchObject({ kind: "text" });
    expect(parsed.kind === "text" && parsed.text).toHaveLength(MAX_MENTION_QUERY_LENGTH);
  });
});

describe("rejectedOrderIds", () => {
  it("accepts ids the thread's warehouse allows", () => {
    expect(rejectedOrderIds(["a", "b"], ["a", "b", "c"])).toEqual([]);
  });

  // The mention is rendered into the vendor's conversation, so an id from
  // outside the thread's warehouse is a disclosure, not a typo to tolerate.
  it("names the ids that are not mentionable here", () => {
    expect(rejectedOrderIds(["a", "x"], ["a", "b"])).toEqual(["x"]);
  });

  it("treats an empty allow-list as rejecting everything", () => {
    expect(rejectedOrderIds(["a"], [])).toEqual(["a"]);
  });

  it("reports a repeated id once", () => {
    expect(rejectedOrderIds(["x", "x"], [])).toEqual(["x"]);
  });

  it("has nothing to reject when nothing was requested", () => {
    expect(rejectedOrderIds([], ["a"])).toEqual([]);
  });
});
