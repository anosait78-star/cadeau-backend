-- Storefront Integration (docs/storefront-integration-plan.md) — inbound-only
-- ingestion from a company's own storefront(s) into orders/products/inventory.
-- Decisions D1-D9 (see the plan doc §4):
--
--   D1/D2 — the API key lives on the connection, not the company: a company
--           may have N `storefront_connections`, each independently
--           mintable/rotatable/revocable (no unique on company_id alone).
--   D7    — `storefront_webhook_events` is an append-first inbox, idempotent
--           on (connection_id, event_type, external_id); failures stay
--           `failed` for manual reprocessing (no auto-retry worker in v1).
--   §8    — `product_variants.selling_price_minor` is the new sellable-price
--           column the storefront `priceMinor` field maps to. `average_cost`
--           (purchase-cost, EPIC-13) is untouched by this migration and by
--           this feature end-to-end.
--
-- Both new tables follow docs/core-data.md §16.2 (id/company_id/created_by/
-- updated_by/timestamps + FORCE RLS by company_id + `app.touch_updated_at()`).
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 0. product_variants.selling_price_minor — the sellable price a storefront's
--    `priceMinor` maps to. Integer minor units, same convention as
--    average_cost on this table. Defaults to 0 so every existing variant is
--    unaffected until an explicit price is set (manually or via sync).
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_variants
  ADD COLUMN selling_price_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_selling_price_check CHECK (selling_price_minor >= 0);

COMMENT ON COLUMN public.product_variants.selling_price_minor IS
  'Sellable price in integer minor units, client- and storefront-writable. '
  'Distinct from average_cost, which stays purchase-cost-only (EPIC-13, '
  'derived exclusively from PO receipts) and is never touched by storefront sync.';

-- ---------------------------------------------------------------------------
-- 1. storefront_connections — one row per connected store. The API key is
--    scoped to the connection (D1/D2): revoking/rotating one connection's key
--    never touches another connection of the same company. Only a scrypt hash
--    is stored (@cadeau/crypto hashPassword), same pattern as user passwords;
--    the plaintext key is shown once, at creation/rotation, and never again.
-- ---------------------------------------------------------------------------
CREATE TABLE public.storefront_connections (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL,
  label                 text        NOT NULL,
  platform              text        NOT NULL DEFAULT 'generic',
  api_key_hash          text        NOT NULL,
  api_key_prefix        varchar(8)  NOT NULL,
  default_warehouse_id  uuid,
  status                text        NOT NULL DEFAULT 'active',
  last_event_at         timestamptz,
  revoked_at            timestamptz,
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefront_connections_pkey PRIMARY KEY (id),
  CONSTRAINT storefront_connections_platform_check CHECK (platform IN (
    'generic', 'salla', 'zid', 'shopify', 'woocommerce'
  )),
  CONSTRAINT storefront_connections_status_check CHECK (status IN (
    'active', 'paused', 'revoked'
  )),
  CONSTRAINT storefront_connections_label_check CHECK (char_length(label) BETWEEN 1 AND 200),
  -- Display-only, never secret; long enough to disambiguate two connections.
  CONSTRAINT storefront_connections_prefix_check CHECK (char_length(api_key_prefix) BETWEEN 4 AND 8),
  -- Friendly-name uniqueness within a tenant (UX, not a security boundary — D2).
  CONSTRAINT storefront_connections_company_label_key UNIQUE (company_id, label),
  CONSTRAINT storefront_connections_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT storefront_connections_warehouse_fk FOREIGN KEY (default_warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.storefront_connections IS
  'Per-company storefront connections (v1: generic JSON contract, D8). Each '
  'connection carries its own API key hash — independent from every other '
  'connection of the same company (D1/D2).';
COMMENT ON COLUMN public.storefront_connections.api_key_hash IS
  'scrypt hash (@cadeau/crypto hashPassword) of the connection''s API key. '
  'The plaintext is never stored and is returned only once, at mint time.';

-- The ingestion guard's hot path: resolve an incoming key's hash to a
-- connection. api_key_hash is not marked UNIQUE — a hash collision is
-- cryptographically negligible and the guard already filters on status.
CREATE INDEX storefront_connections_key_lookup_idx
  ON public.storefront_connections (api_key_hash) WHERE status = 'active';
CREATE INDEX storefront_connections_company_idx
  ON public.storefront_connections (company_id, created_at DESC, id DESC);

CREATE TRIGGER storefront_connections_touch_updated_at
  BEFORE UPDATE ON public.storefront_connections
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.storefront_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_connections FORCE  ROW LEVEL SECURITY;

CREATE POLICY storefront_connections_tenant ON public.storefront_connections
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. storefront_webhook_events — append-first inbox for both ingestion routes
--    (orders + products). company_id is copied from the connection at write
--    time so RLS/filtering never needs a join (D7). Idempotent on
--    (connection_id, event_type, external_id): a store re-sending the same
--    order/product is a no-op, not a duplicate.
-- ---------------------------------------------------------------------------
CREATE TABLE public.storefront_webhook_events (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL,
  connection_id       uuid        NOT NULL,
  event_type          text        NOT NULL,
  external_id         text        NOT NULL,
  payload             jsonb       NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  error               text,
  internal_entity_id  uuid,
  attempt_count       integer     NOT NULL DEFAULT 1,
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefront_webhook_events_pkey PRIMARY KEY (id),
  CONSTRAINT storefront_webhook_events_event_type_check CHECK (event_type IN ('order', 'product')),
  CONSTRAINT storefront_webhook_events_status_check CHECK (status IN (
    'pending', 'processed', 'failed'
  )),
  CONSTRAINT storefront_webhook_events_attempt_count_check CHECK (attempt_count >= 1),
  CONSTRAINT storefront_webhook_events_external_id_check CHECK (char_length(external_id) BETWEEN 1 AND 200),
  CONSTRAINT storefront_webhook_events_idem_key UNIQUE (connection_id, event_type, external_id),
  CONSTRAINT storefront_webhook_events_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT storefront_webhook_events_connection_fk FOREIGN KEY (connection_id)
    REFERENCES public.storefront_connections (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.storefront_webhook_events IS
  'Append-first inbox for inbound storefront orders/products (D7). '
  'UNIQUE(connection_id, event_type, external_id) makes a re-sent event a '
  'no-op; a failed row is re-run manually from the settings UI (no auto-'
  'retry worker in v1 — contrast shipping_webhook_events).';

CREATE INDEX storefront_webhook_events_keyset_idx
  ON public.storefront_webhook_events (company_id, received_at DESC, id DESC);
CREATE INDEX storefront_webhook_events_connection_idx
  ON public.storefront_webhook_events (connection_id, received_at DESC, id DESC);

CREATE TRIGGER storefront_webhook_events_touch_updated_at
  BEFORE UPDATE ON public.storefront_webhook_events
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.storefront_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_webhook_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY storefront_webhook_events_tenant ON public.storefront_webhook_events
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 3. stock_adjustments.reason — add 'storefront_sync' to the closed set (D5).
--    No new calculation logic: the existing adjustment trigger/available
--    derivation is reused as-is; this is purely a new allowed reason code.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_adjustments
  DROP CONSTRAINT stock_adjustments_reason_check;

ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT stock_adjustments_reason_check
  CHECK (reason IN ('count', 'damage', 'loss', 'return', 'other', 'storefront_sync'));
