import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookSignatureError } from "../errors";
import { signWebhookPayload, verifyWebhookSignature } from "../webhook-signature";

// 32-byte key as 64 hex chars (matches @cadeau/config shipping.webhookSigningSecret).
const KEY = "000000000000000000000000000000000000000000000000000000000000cccc";
const OTHER_KEY = "1111111111111111111111111111111111111111111111111111111111111111";
const BODY = '{"eventId":"evt_1","trackingNumber":"MAN-ABC123","status":"picked_up"}';

describe("webhook signature (HMAC-SHA256)", () => {
  it("is deterministic", () => {
    expect(signWebhookPayload(BODY, KEY)).toBe(signWebhookPayload(BODY, KEY));
  });

  it("returns 64 lowercase hex characters", () => {
    expect(signWebhookPayload(BODY, KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a plain HMAC-SHA256 of the raw body under the key", () => {
    const expected = createHmac("sha256", Buffer.from(KEY, "hex")).update(BODY).digest("hex");
    expect(signWebhookPayload(BODY, KEY)).toBe(expected);
  });

  it("separates different bodies", () => {
    expect(signWebhookPayload(BODY, KEY)).not.toBe(signWebhookPayload(BODY + "x", KEY));
  });

  it("is keyed — the same body under a different key gives a different signature", () => {
    expect(signWebhookPayload(BODY, KEY)).not.toBe(signWebhookPayload(BODY, OTHER_KEY));
  });

  it("accepts a Buffer body identically to the equivalent string", () => {
    expect(signWebhookPayload(Buffer.from(BODY, "utf8"), KEY)).toBe(signWebhookPayload(BODY, KEY));
  });

  it("verifies a correctly signed body without throwing", () => {
    const signature = signWebhookPayload(BODY, KEY);
    expect(() => verifyWebhookSignature(BODY, signature, KEY)).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const signature = signWebhookPayload(BODY, KEY);
    expect(() => verifyWebhookSignature(BODY + "tampered", signature, KEY)).toThrow(
      WebhookSignatureError,
    );
  });

  it("rejects a signature computed under a different key", () => {
    const signature = signWebhookPayload(BODY, OTHER_KEY);
    expect(() => verifyWebhookSignature(BODY, signature, KEY)).toThrow(WebhookSignatureError);
  });

  it("rejects a malformed (non-hex) signature", () => {
    expect(() => verifyWebhookSignature(BODY, "not-hex!!", KEY)).toThrow(WebhookSignatureError);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => signWebhookPayload(BODY, "abcd")).toThrow(WebhookSignatureError);
    expect(() => signWebhookPayload(BODY, "00".repeat(16))).toThrow(WebhookSignatureError);
  });

  it("rejects a non-hex key", () => {
    expect(() => signWebhookPayload(BODY, "z".repeat(64))).toThrow(WebhookSignatureError);
  });
});
