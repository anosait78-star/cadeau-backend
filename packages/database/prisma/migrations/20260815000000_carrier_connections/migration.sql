-- Settings > Shipping: real per-carrier connections (Bosta integration).
-- `api_key_encrypted` is AES-256-GCM ciphertext (`@cadeau/crypto`), same
-- scheme as `profiles.totp_secret_encrypted` / `phone_encrypted` — never
-- plaintext at rest. `webhook_token_hash` is a SHA-256 hash of a random
-- token minted at connect time (Bosta has no HMAC webhook signing, unlike
-- our own generic `WebhookSignatureGuard`); the raw token is shown once,
-- embedded in the `webhookUrl` registered with the carrier, and never
-- persisted — same "store the hash, not the secret" pattern as
-- `invitations.code_hash`.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

CREATE TABLE public.carrier_connections (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL,
  carrier                  text        NOT NULL,
  api_key_encrypted        text        NOT NULL,
  webhook_token_hash       text        NOT NULL,
  pickup_location_warning  boolean     NOT NULL DEFAULT false,
  is_active                boolean     NOT NULL DEFAULT true,
  connected_by             uuid,
  connected_at             timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carrier_connections_pkey PRIMARY KEY (id),
  CONSTRAINT carrier_connections_company_carrier_key UNIQUE (company_id, carrier),
  CONSTRAINT carrier_connections_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.carrier_connections IS
  'Per-tenant real-carrier connections (e.g. Bosta). API keys are encrypted at rest.';

CREATE INDEX carrier_connections_company_idx ON public.carrier_connections (company_id, carrier);

CREATE TRIGGER carrier_connections_touch_updated_at
  BEFORE UPDATE ON public.carrier_connections
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.carrier_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_connections FORCE  ROW LEVEL SECURITY;

CREATE POLICY carrier_connections_tenant ON public.carrier_connections
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
