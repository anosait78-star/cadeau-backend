import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EncryptionError } from "./errors";

/**
 * Authenticated PII encryption with AES-256-GCM. Encrypts customer phones,
 * addresses, and other sensitive fields at the application layer before they are
 * stored (ADR-001). GCM provides confidentiality *and* integrity: tampering with
 * the ciphertext fails the auth tag on decrypt.
 *
 * The key is the 32-byte value from `@cadeau/config` `encryption.key`, passed in
 * as 64 hex characters (crypto stays config-free; the caller supplies the key).
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const VERSION = "v1";

function toKey(keyHex: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(keyHex, "hex");
  } catch {
    throw new EncryptionError("Encryption key must be hex.");
  }
  if (key.length !== 32) {
    throw new EncryptionError("Encryption key must be 32 bytes (64 hex characters).");
  }
  return key;
}

/**
 * Encrypt UTF-8 plaintext. Returns a self-describing token
 * `v1.<iv>.<tag>.<ciphertext>` (base64url); a fresh random IV is used every call,
 * so encrypting the same value twice yields different tokens.
 */
export function encrypt(plainText: string, keyHex: string): string {
  const key = toKey(keyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Decrypt a token from {@link encrypt}. Throws {@link EncryptionError} if the key is wrong or the data was tampered with. */
export function decrypt(token: string, keyHex: string): string {
  const key = toKey(keyHex);
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new EncryptionError("Malformed ciphertext token.");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new EncryptionError("Decryption failed: wrong key or tampered data.");
  }
}
