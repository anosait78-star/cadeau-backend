import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWooCommerceWebhookSignature } from "../woocommerce-webhook-signature";

const SECRET = "wc-secret-123";

function sign(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

describe("verifyWooCommerceWebhookSignature", () => {
  it("accepts a signature computed the same way WooCommerce computes it", () => {
    const rawBody = Buffer.from('{"id":123,"status":"processing"}');
    expect(verifyWooCommerceWebhookSignature(rawBody, sign(rawBody, SECRET), SECRET)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = Buffer.from('{"id":123}');
    expect(verifyWooCommerceWebhookSignature(rawBody, sign(rawBody, "wrong-secret"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a signature computed over different bytes (tampered body)", () => {
    const original = Buffer.from('{"id":123}');
    const tampered = Buffer.from('{"id":124}');
    expect(verifyWooCommerceWebhookSignature(tampered, sign(original, SECRET), SECRET)).toBe(false);
  });

  it("rejects a garbage/malformed signature", () => {
    const rawBody = Buffer.from('{"id":123}');
    expect(verifyWooCommerceWebhookSignature(rawBody, "not-base64-hmac", SECRET)).toBe(false);
  });
});
