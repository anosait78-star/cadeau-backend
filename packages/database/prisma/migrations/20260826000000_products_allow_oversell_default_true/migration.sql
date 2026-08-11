-- Oversell policy default flip (2026-08-26): orders should go through even
-- when a product's stock reads zero, for every product going forward
-- (manual creates and WooCommerce-synced creates alike). Existing rows are
-- backfilled separately (apps/api/scripts/backfill-allow-oversell.mjs) since
-- that is a per-tenant data change, not a schema default.
ALTER TABLE public.products ALTER COLUMN allow_oversell SET DEFAULT true;
