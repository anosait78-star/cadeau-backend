import { describe, expect, it } from "vitest";
import { normalizePhone, parsePaste } from "./smart-paste";

describe("normalizePhone", () => {
  it("normalizes Egyptian mobile numbers to E.164", () => {
    expect(normalizePhone("01001234567")).toBe("+201001234567");
    expect(normalizePhone("010 0123 4567")).toBe("+201001234567");
  });

  it("keeps a valid +international number", () => {
    expect(normalizePhone("+201001234567")).toBe("+201001234567");
    expect(normalizePhone("00201001234567")).toBe("+201001234567");
  });

  it("converts Arabic-Indic digits", () => {
    expect(normalizePhone("٠١٠٠١٢٣٤٥٦٧")).toBe("+201001234567");
  });

  it("accepts a bare country-coded number", () => {
    expect(normalizePhone("201001234567")).toBe("+201001234567");
  });

  it("rejects nonsense", () => {
    expect(normalizePhone("hello")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("+abc")).toBeNull();
  });
});

describe("parsePaste", () => {
  it("reads labeled fields (en + ar)", () => {
    const draft = parsePaste("Name: Sara Ali\nPhone: 01001234567\nAddress: 12 Nile St, Cairo");
    expect(draft.name).toBe("Sara Ali");
    expect(draft.phone).toBe("+201001234567");
    expect(draft.address).toBe("12 Nile St, Cairo");
  });

  it("extracts qty × name item lines in both orders and Arabic digits", () => {
    const draft = parsePaste("2 x Red Shirt\nBlue Cap x3\n٤ حذاء");
    expect(draft.items).toEqual([
      { name: "Red Shirt", quantity: 2 },
      { name: "Blue Cap", quantity: 3 },
      { name: "حذاء", quantity: 4 },
    ]);
  });

  it("finds a bare phone line without a label", () => {
    const draft = parsePaste("Mona\n01112223334\nSome long delivery address here in Giza");
    expect(draft.phone).toBe("+201112223334");
    expect(draft.name).toBe("Mona");
    expect(draft.address).toBe("Some long delivery address here in Giza");
  });

  it("is deterministic — same input, same output", () => {
    const text = "Name: A\n01001234567\n2 x Item\nleftover note";
    expect(parsePaste(text)).toEqual(parsePaste(text));
  });

  it("keeps unclassified lines in notes rather than dropping them", () => {
    const draft = parsePaste("Name: A\nrandom scribble\nanother");
    expect(draft.notes).toContain("another");
  });

  it("reads a phone from a labeled line with surrounding text and a * item", () => {
    const draft = parsePaste("Phone: call me on 010 0123 4567 please\nWidget * 5");
    expect(draft.phone).toBe("+201001234567");
    expect(draft.items).toEqual([{ name: "Widget", quantity: 5 }]);
  });

  it("returns an all-null draft for empty input", () => {
    expect(parsePaste("   \n  ")).toEqual({
      name: null,
      phone: null,
      address: null,
      items: [],
      notes: null,
    });
  });
});
