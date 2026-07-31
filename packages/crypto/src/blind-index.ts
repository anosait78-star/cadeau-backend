import { createHmac } from "node:crypto";
import { BlindIndexError } from "./errors";

/**
 * Keyed blind indexes for sensitive columns (EPIC-10, ADR-001).
 *
 * A value encrypted with {@link encrypt} uses a fresh random IV every write, so
 * the same plaintext never produces the same ciphertext — which is exactly what
 * makes the ciphertext safe, and exactly what makes it useless as an index key.
 * A blind index is the searchable companion: a **deterministic** HMAC of the
 * plaintext, stored beside the ciphertext, that can carry a UNIQUE constraint and
 * answer exact-match lookups without being reversible.
 *
 * A bare hash would not do: the space of phone numbers is small enough to
 * enumerate in seconds. The HMAC key — held by the application, never by the
 * database — is what makes a stolen dump useless on its own.
 *
 * The index reveals **equality and nothing else**, and it is never the only copy
 * of a value: the ciphertext stays the source of truth so the index can be
 * rebuilt when the key rotates. See `docs/privacy-model.md`.
 */
const ALGORITHM = "sha256";

function toKey(keyHex: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(keyHex, "hex");
  } catch {
    throw new BlindIndexError("Blind-index key must be hex.");
  }
  if (key.length !== 32) {
    throw new BlindIndexError("Blind-index key must be 32 bytes (64 hex characters).");
  }
  return key;
}

/**
 * Compute the blind index of an already-normalized value. Returns 64 lowercase
 * hex characters.
 *
 * **The caller must normalize first.** This function hashes exactly the bytes it
 * is given: `"+20 100 123 4567"` and `"+201001234567"` produce different indexes,
 * so a uniqueness rule built on un-normalized input silently fails to catch
 * duplicates. Normalization belongs to the domain that owns the value (for
 * phones, E.164), not here.
 */
export function blindIndex(normalizedValue: string, keyHex: string): string {
  if (normalizedValue.length === 0) {
    throw new BlindIndexError("Cannot index an empty value.");
  }
  return createHmac(ALGORITHM, toKey(keyHex)).update(normalizedValue, "utf8").digest("hex");
}
