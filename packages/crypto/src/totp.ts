import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TotpError } from "./errors";

/**
 * Self-built time-based one-time passwords (TOTP, RFC 6238 over HOTP, RFC 4226) —
 * the locked stack mandates in-house 2FA with no external OTP library. Secrets are
 * base32 (RFC 4648, no padding), the interoperable encoding every authenticator
 * app (Google Authenticator, Authy, 1Password, …) understands.
 *
 * Defaults match those apps: HMAC-SHA1, 6 digits, a 30-second step. Codes are
 * compared in constant time across a small window to tolerate clock skew.
 *
 * `node:crypto` only — no external dependency (ADR-001).
 */

/** RFC 4648 base32 alphabet (no padding). */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const DEFAULTS = {
  /** Digits in a generated code. */
  digits: 6,
  /** Time step in seconds. */
  stepSeconds: 30,
  /** Steps of clock skew tolerated on each side when verifying. */
  window: 1,
} as const;

/** Encode bytes to an unpadded, upper-case RFC 4648 base32 string. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/**
 * Decode an RFC 4648 base32 string (case-insensitive; spaces and `=` padding are
 * ignored) to bytes. Throws {@link TotpError} on any non-alphabet character.
 */
export function base32Decode(secret: string): Buffer {
  const normalized = secret.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new TotpError("Secret is not valid base32.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generate a random TOTP secret as a base32 string. 20 bytes (160 bits) is the
 * SHA-1 HMAC block-adjacent default recommended by RFC 4226 §4.
 */
export function generateTotpSecret(byteLength = 20): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new TotpError("TOTP secret must be at least 16 bytes.");
  }
  return base32Encode(randomBytes(byteLength));
}

export interface TotpOptions {
  /** Digits in the code (default 6). */
  readonly digits?: number;
  /** Time step in seconds (default 30). */
  readonly stepSeconds?: number;
  /** Override "now" (ms since epoch) — for tests and deterministic verification. */
  readonly now?: number;
}

/** The 8-byte big-endian counter for a given time step. */
function counterBuffer(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  // 32-bit halves avoid the 53-bit float limits of a single writeBigUInt call
  // while staying dependency-free; counters stay well within 2^53 for centuries.
  buffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  return buffer;
}

/** RFC 4226 dynamic truncation of an HMAC digest into a zero-padded code. */
function truncate(hmac: Buffer, digits: number): string {
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const binary =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * Generate the TOTP code for a base32 `secret` at the given (or current) time.
 * HMAC-SHA1 over the 30-second step counter, dynamically truncated to `digits`.
 */
export function generateTotp(secret: string, options: TotpOptions = {}): string {
  const digits = options.digits ?? DEFAULTS.digits;
  const stepSeconds = options.stepSeconds ?? DEFAULTS.stepSeconds;
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new TotpError("TOTP digits must be between 6 and 8.");
  }
  if (!Number.isInteger(stepSeconds) || stepSeconds < 1) {
    throw new TotpError("TOTP step must be a positive number of seconds.");
  }
  const key = base32Decode(secret);
  const counter = Math.floor((options.now ?? Date.now()) / 1000 / stepSeconds);
  const hmac = createHmac("sha1", key).update(counterBuffer(counter)).digest();
  return truncate(hmac, digits);
}

export interface VerifyTotpOptions extends TotpOptions {
  /** Steps of clock skew tolerated on each side (default 1 ⇒ ±30s). */
  readonly window?: number;
}

/**
 * Verify a user-supplied `code` against a base32 `secret`, tolerating ±`window`
 * time steps of clock skew. Returns `false` (never throws) for a code of the
 * wrong shape; a malformed secret still throws {@link TotpError} (a server-side
 * misconfiguration, not user input). Every candidate is compared in constant
 * time, and all candidates are always evaluated so timing does not reveal which
 * step matched.
 */
export function verifyTotp(code: string, secret: string, options: VerifyTotpOptions = {}): boolean {
  const digits = options.digits ?? DEFAULTS.digits;
  const stepSeconds = options.stepSeconds ?? DEFAULTS.stepSeconds;
  const window = options.window ?? DEFAULTS.window;
  if (!Number.isInteger(window) || window < 0) {
    throw new TotpError("TOTP window must be a non-negative integer.");
  }
  const trimmed = code.trim();
  if (!new RegExp(`^\\d{${digits}}$`).test(trimmed)) {
    return false;
  }
  const now = options.now ?? Date.now();
  const provided = Buffer.from(trimmed);
  let matched = false;
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateTotp(secret, {
      digits,
      stepSeconds,
      now: now + offset * stepSeconds * 1000,
    });
    const candidateBuf = Buffer.from(candidate);
    if (candidateBuf.length === provided.length && timingSafeEqual(candidateBuf, provided)) {
      matched = true;
    }
  }
  return matched;
}

export interface OtpAuthUriInput {
  /** Base32 secret shared with the authenticator app. */
  readonly secret: string;
  /** Account label, typically the user's email. */
  readonly account: string;
  /** Issuer shown in the authenticator app (the product name). */
  readonly issuer: string;
  readonly digits?: number;
  readonly stepSeconds?: number;
}

/**
 * Build the `otpauth://totp/…` provisioning URI an authenticator app consumes
 * (usually rendered as a QR code by the client). Follows the Key URI Format used
 * by Google Authenticator: the label is `Issuer:account`, and `issuer` is also a
 * parameter for apps that read it there.
 */
export function buildOtpAuthUri(input: OtpAuthUriInput): string {
  const label = `${input.issuer}:${input.account}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(input.digits ?? DEFAULTS.digits),
    period: String(input.stepSeconds ?? DEFAULTS.stepSeconds),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
