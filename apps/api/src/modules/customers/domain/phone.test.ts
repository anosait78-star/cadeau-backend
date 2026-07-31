import { describe, expect, it } from "vitest";
import { isE164Like, maskPhone, normalizeE164 } from "./phone";

describe("normalizeE164", () => {
  it("passes through an already-normalized number", () => {
    expect(normalizeE164("+201001234567")).toBe("+201001234567");
  });

  it("strips the noise humans type", () => {
    // Every one of these must collapse to the same value, or the unique index
    // on the blind index does not actually prevent duplicates.
    for (const raw of [
      "+20 100 123 4567",
      "+20-100-123-4567",
      "+20 (100) 123-4567",
      "+20.100.123.4567",
      "  +201001234567  ",
    ]) {
      expect(normalizeE164(raw)).toBe("+201001234567");
    }
  });

  it("converts the 00 international access code to +", () => {
    expect(normalizeE164("00201001234567")).toBe("+201001234567");
    expect(normalizeE164("0020 100 123 4567")).toBe("+201001234567");
  });

  it("rejects a bare national number (country is unknowable here)", () => {
    expect(normalizeE164("01001234567")).toBeNull();
    expect(normalizeE164("1001234567")).toBeNull();
  });

  it("rejects a country code starting with 0", () => {
    expect(normalizeE164("+0201234567")).toBeNull();
  });

  it("rejects non-digits after the prefix", () => {
    expect(normalizeE164("+2010abc4567")).toBeNull();
    expect(normalizeE164("+20100+1234567")).toBeNull();
  });

  it("rejects too-short and too-long numbers", () => {
    expect(normalizeE164("+2010")).toBeNull();
    expect(normalizeE164(`+${"9".repeat(16)}`)).toBeNull();
  });

  it("accepts the E.164 length boundaries", () => {
    expect(normalizeE164(`+${"9".repeat(8)}`)).toBe(`+${"9".repeat(8)}`);
    expect(normalizeE164(`+${"9".repeat(15)}`)).toBe(`+${"9".repeat(15)}`);
  });

  it("rejects empty and noise-only input", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("   ")).toBeNull();
    expect(normalizeE164("()-")).toBeNull();
  });
});

describe("isE164Like", () => {
  it("mirrors normalizeE164", () => {
    expect(isE164Like("+20 100 123 4567")).toBe(true);
    expect(isE164Like("Ahmed")).toBe(false);
    expect(isE164Like("01001234567")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps the country code and the last four digits", () => {
    expect(maskPhone("+201001234567")).toBe("+2010•••4567");
  });

  it("never reveals the middle digits", () => {
    const masked = maskPhone("+201005556789");
    expect(masked).not.toContain("555");
    expect(masked.endsWith("6789")).toBe(true);
  });

  it("handles a short number without throwing or over-revealing", () => {
    expect(maskPhone("+12345678")).toBe("+1234•••5678");
  });
});
