import { describe, expect, it } from "vitest";
import { TotpError } from "../errors";
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from "../totp";

// RFC 6238 Appendix B test key (ASCII "12345678901234567890") as base32.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x7a, 0x42, 0x99, 0x01]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it("is case-insensitive and ignores spaces/padding", () => {
    const encoded = base32Encode(Buffer.from("hello", "ascii"));
    const noisy = `${encoded.toLowerCase().slice(0, 4)} ${encoded.toLowerCase().slice(4)}==`;
    expect(base32Decode(noisy).toString("ascii")).toBe("hello");
  });

  it("rejects non-alphabet characters", () => {
    expect(() => base32Decode("0189!")).toThrow(TotpError);
  });
});

describe("TOTP (RFC 6238, self-built)", () => {
  it("matches the RFC 6238 test vectors (SHA1)", () => {
    // T=59s ⇒ step counter 1; the RFC's 8-digit value is 94287082.
    expect(generateTotp(RFC_SECRET, { now: 59_000, digits: 8 })).toBe("94287082");
    expect(generateTotp(RFC_SECRET, { now: 59_000 })).toBe("287082");
    expect(generateTotp(RFC_SECRET, { now: 1_111_111_109_000, digits: 8 })).toBe("07081804");
    expect(generateTotp(RFC_SECRET, { now: 1_234_567_890_000, digits: 8 })).toBe("89005924");
  });

  it("verifies a freshly generated code", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = generateTotp(secret, { now });
    expect(verifyTotp(code, secret, { now })).toBe(true);
  });

  it("tolerates one step of clock skew within the window", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const previous = generateTotp(secret, { now: now - 30_000 });
    expect(verifyTotp(previous, secret, { now, window: 1 })).toBe(true);
    expect(verifyTotp(previous, secret, { now, window: 0 })).toBe(false);
  });

  it("rejects a wrong or wrong-shaped code without throwing", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp("000000", secret, { now })).toBe(false);
    expect(verifyTotp("12345", secret, { now })).toBe(false); // too short
    expect(verifyTotp("abcdef", secret, { now })).toBe(false); // non-numeric
  });

  it("rejects invalid parameters", () => {
    expect(() => generateTotp(RFC_SECRET, { digits: 4 })).toThrow(TotpError);
    expect(() => generateTotpSecret(8)).toThrow(TotpError);
  });
});

describe("otpauth URI", () => {
  it("encodes issuer, account, and parameters", () => {
    const uri = buildOtpAuthUri({
      secret: "ABCDEFGH",
      account: "founder@acme.test",
      issuer: "Cadeau CRM",
    });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(encodeURIComponent("Cadeau CRM:founder@acme.test"));
    expect(uri).toContain("secret=ABCDEFGH");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
