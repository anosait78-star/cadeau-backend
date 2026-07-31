import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors";

/**
 * Inbound carrier-webhook signatures (EPIC-12 M12.4, ADR-001).
 *
 * A keyed HMAC-SHA256 over the **exact raw request bytes** — never a
 * re-serialized/parsed body, which can byte-differ from what was actually
 * signed (key order, whitespace, unicode escaping). The signing key is shared
 * out-of-band with the carrier and held only by the application (never the
 * database), same posture as {@link blindIndex}'s HMAC key.
 */
const ALGORITHM = "sha256";
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

function toKey(keyHex: string): Buffer {
  const key = decodeHex(keyHex, "Webhook signing key must be hex.");
  if (key.length !== 32) {
    throw new WebhookSignatureError("Webhook signing key must be 32 bytes (64 hex characters).");
  }
  return key;
}

function decodeHex(value: string, message: string): Buffer {
  if (!HEX_PATTERN.test(value) || value.length % 2 !== 0) {
    throw new WebhookSignatureError(message);
  }
  return Buffer.from(value, "hex");
}

/** Sign a raw webhook body, returning a lowercase hex HMAC-SHA256 digest. */
export function signWebhookPayload(rawBody: string | Buffer, keyHex: string): string {
  return createHmac(ALGORITHM, toKey(keyHex)).update(rawBody).digest("hex");
}

/**
 * Verify a webhook signature against the raw body it was computed over.
 * Constant-time compare; throws {@link WebhookSignatureError} on any
 * mismatch or malformed input (never returns `false` — a caller cannot
 * accidentally ignore the result).
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHex: string,
  keyHex: string,
): void {
  const expected = decodeHex(signWebhookPayload(rawBody, keyHex), "Invalid webhook signature.");
  const provided = decodeHex(signatureHex, "Invalid webhook signature.");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new WebhookSignatureError("Invalid webhook signature.");
  }
}
