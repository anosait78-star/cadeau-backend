import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// promisify infers the 3-arg overload and drops `options`; type it explicitly so
// the scrypt cost parameters (N/r/p) can be passed.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * scrypt cost parameters. N=16384 (2^14) is the interactive-login baseline;
 * memory use ≈ 128·N·r ≈ 16 MB, within Node's default maxmem. The parameters are
 * stored in each hash so they can be raised later without breaking old hashes.
 */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = "scrypt";

/**
 * Hash a password with a random per-password salt. The result is a self-describing
 * string `scrypt$N$r$p$salt$hash` (base64url), so {@link verifyPassword} needs no
 * external parameters. Passwords are never stored or logged in plaintext.
 */
export async function hashPassword(plainText: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scryptAsync(plainText, salt, KEY_LENGTH, PARAMS)) as Buffer;
  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Verify a password against a stored {@link hashPassword} string. Uses a
 * constant-time comparison so a mismatch leaks no timing information. Returns
 * `false` (never throws) for any malformed stored value.
 */
export async function verifyPassword(plainText: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltRaw ?? "", "base64url");
  const expected = Buffer.from(hashRaw ?? "", "base64url");
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = (await scryptAsync(plainText, salt, expected.length, { N: n, r, p })) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
