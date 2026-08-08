-- Storefront Integration — corrects the ingestion guard's lookup index.
--
-- scrypt (hashPassword) salts every hash independently, so an inbound key's
-- hash can never be looked up by equality against api_key_hash — the guard
-- actually narrows candidates by the key's non-secret apiKeyPrefix (usually
-- to exactly one active row) and verifies each candidate's apiKeyHash with
-- verifyPassword (StorefrontApiKeyGuard, storefront-integration §D1/D3).
-- The 20260820000000_storefront_integration migration indexed the wrong
-- column for this query pattern; this migration fixes it forward rather than
-- editing the already-applied migration file.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

DROP INDEX IF EXISTS public.storefront_connections_key_lookup_idx;

CREATE INDEX storefront_connections_key_prefix_idx
  ON public.storefront_connections (api_key_prefix)
  WHERE status = 'active';
