import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../encryption";
import { EncryptionError } from "../errors";

// 32-byte key as 64 hex chars (matches @cadeau/config encryption.key).
const KEY = "000000000000000000000000000000000000000000000000000000000000ffff";
const OTHER_KEY = "1111111111111111111111111111111111111111111111111111111111111111";

describe("PII encryption (AES-256-GCM)", () => {
  it("round-trips plaintext", () => {
    const token = encrypt("+201234567890", KEY);
    expect(decrypt(token, KEY)).toBe("+201234567890");
  });

  it("uses a fresh IV so identical plaintext encrypts to different tokens", () => {
    expect(encrypt("same", KEY)).not.toBe(encrypt("same", KEY));
  });

  it("produces a versioned, dot-delimited token", () => {
    expect(encrypt("x", KEY).split(".")).toHaveLength(4);
    expect(encrypt("x", KEY).startsWith("v1.")).toBe(true);
  });

  it("fails to decrypt with the wrong key", () => {
    const token = encrypt("secret", KEY);
    expect(() => decrypt(token, OTHER_KEY)).toThrow(EncryptionError);
  });

  it("fails to decrypt tampered ciphertext (auth tag)", () => {
    const token = encrypt("secret", KEY);
    const parts = token.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64url")].join(
      ".",
    );
    expect(() => decrypt(tampered, KEY)).toThrow(EncryptionError);
  });

  it("rejects a bad key length and a malformed token", () => {
    expect(() => encrypt("x", "abcd")).toThrow(EncryptionError);
    expect(() => decrypt("not-a-token", KEY)).toThrow(EncryptionError);
  });
});
