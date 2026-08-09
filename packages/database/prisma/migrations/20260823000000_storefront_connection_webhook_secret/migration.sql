-- Storefront Integration — WooCommerce readiness (docs/storefront-integration-plan.md,
-- D8: per-platform adapters are additive peers behind StorefrontAdapterPort).
--
-- Adds an optional, per-connection webhook signing secret so the ingestion
-- guard can verify a platform's own webhook signature (e.g. WooCommerce's
-- `X-WC-Webhook-Signature`, HMAC-SHA256/base64) as a SUPPLEMENTARY check on
-- top of the existing API-key trust boundary (D3) — never a replacement for
-- it. Stored encrypted (AES-256-GCM, `@cadeau/crypto` encrypt/decrypt, the
-- same `encryption.key` already used for `carrier_connections.api_key_encrypted`)
-- rather than hashed like the API key, because the raw value must be
-- recoverable to compute an HMAC — a one-way hash cannot serve that purpose.
-- Write-only at the API boundary: no read view/DTO ever returns this column.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.storefront_connections
  ADD COLUMN webhook_secret_encrypted text;

COMMENT ON COLUMN public.storefront_connections.webhook_secret_encrypted IS
  'AES-256-GCM ciphertext (@cadeau/crypto encrypt/decrypt) of an optional '
  'per-connection webhook signing secret, set by the admin from the store''s '
  'own webhook configuration (e.g. WooCommerce). Null when not configured, '
  'in which case the ingestion guard relies on the API key alone (D3). '
  'Never selected into any read view/DTO — write-only at the API boundary.';
