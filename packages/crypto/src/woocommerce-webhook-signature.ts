import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WooCommerce's own inbound-webhook signature: `base64(hmac_sha256(secret,
 * rawBody))`, sent in the `X-WC-Webhook-Signature` header — see
 * https://woocommerce.github.io/code-reference/classes/WC-Webhook.html.
 * Deliberately separate from {@link verifyWebhookSignature} (used by
 * `shipping`'s `WebhookSignatureGuard`): that one assumes a 32-byte hex
 * signing key and a hex-encoded signature — WooCommerce's secret is an
 * arbitrary string and its signature is base64, a genuinely different wire
 * format, not a variant worth overloading the existing function's contract
 * for.
 *
 * Verification is a SUPPLEMENTARY check on top of the storefront API key
 * (`StorefrontApiKeyGuard`, which remains the sole required trust boundary,
 * storefront-integration §D3) — only run when a connection has opted in by
 * configuring a webhook secret.
 */
export function verifyWooCommerceWebhookSignature(
  rawBody: Buffer,
  signatureBase64: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signatureBase64, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
