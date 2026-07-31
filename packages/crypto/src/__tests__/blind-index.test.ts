import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blindIndex } from "../blind-index";
import { encrypt } from "../encryption";
import { BlindIndexError } from "../errors";

// 32-byte key as 64 hex chars (matches @cadeau/config encryption.blindIndexKey).
const KEY = "000000000000000000000000000000000000000000000000000000000000aaaa";
const OTHER_KEY = "1111111111111111111111111111111111111111111111111111111111111111";

describe("PII blind index (HMAC-SHA256)", () => {
  it("is deterministic — the property that makes it indexable", () => {
    expect(blindIndex("+201001234567", KEY)).toBe(blindIndex("+201001234567", KEY));
  });

  it("returns 64 lowercase hex characters", () => {
    expect(blindIndex("+201001234567", KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates different values", () => {
    expect(blindIndex("+201001234567", KEY)).not.toBe(blindIndex("+201001234568", KEY));
  });

  it("is keyed — the same value under a different key gives a different index", () => {
    expect(blindIndex("+201001234567", KEY)).not.toBe(blindIndex("+201001234567", OTHER_KEY));
  });

  it("matches a plain HMAC-SHA256 of the value under the key", () => {
    const expected = createHmac("sha256", Buffer.from(KEY, "hex"))
      .update("+201001234567", "utf8")
      .digest("hex");
    expect(blindIndex("+201001234567", KEY)).toBe(expected);
  });

  it("does not normalize — the caller must", () => {
    // Documented contract: identical-looking numbers in different formats are
    // different indexes, which is why E.164 normalization happens in the domain.
    expect(blindIndex("+20 100 123 4567", KEY)).not.toBe(blindIndex("+201001234567", KEY));
  });

  it("is unlike the ciphertext of the same value (different purpose, different output)", () => {
    const value = "+201001234567";
    expect(blindIndex(value, KEY)).not.toBe(encrypt(value, KEY));
  });

  it("rejects an empty value", () => {
    expect(() => blindIndex("", KEY)).toThrow(BlindIndexError);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => blindIndex("x", "abcd")).toThrow(BlindIndexError);
    expect(() => blindIndex("x", "00".repeat(16))).toThrow(BlindIndexError);
  });

  it("rejects a non-hex key", () => {
    expect(() => blindIndex("x", "z".repeat(64))).toThrow(BlindIndexError);
  });
});
