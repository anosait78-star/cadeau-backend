-- A variant the CRM invented so an order could be accepted (2026-10-14).
--
-- The storefront's product webhook was disabled between 29 Sept and today,
-- so 65 products were published and sold on cadeauegypt.com while the CRM
-- had never heard of them. Every order touching one was rejected outright
-- with `No variant found for sku "..."` — a real, paid customer order lost
-- because the catalogue was behind.
--
-- The policy call (2026-10-14, same reasoning as the placeholder phone of
-- 2026-09-12 and the vendor warehouse fallback of 2026-09-07): an order is
-- never rejected over a product. Ingestion creates a variant carrying only
-- what the order line itself said — name, price, quantity — and flags it
-- here. The order then flows through reservation, picking, invoicing and
-- vendor grouping unchanged, because the line still points at a real
-- `product_variants` row; the flag is what the UI reads to show the staff
-- "this product is not in the CRM" next to its name.
--
-- Self-healing by design: the flag lives on the variant, and the product
-- webhook's upsert already matches on `sku`, so the moment the real product
-- finally arrives it updates this same row and clears the flag. Nothing has
-- to be reconciled by hand.
--
-- Defaults false and is NOT NULL: every variant that existed before today
-- was entered deliberately, by staff or by a product that really did sync.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.product_variants
  ADD COLUMN is_placeholder boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_variants.is_placeholder IS
  'True when storefront ingestion invented this variant from an order line because no variant matched the line sku. Cleared automatically when the real product syncs. Such a variant has a selling price but no cost, so profit figures that include it are overstated.';

-- Partial: the flagged rows are the rare ones, and the only query is "show me
-- the variants someone still has to complete".
CREATE INDEX product_variants_placeholder_idx
  ON public.product_variants (company_id, created_at DESC, id DESC)
  WHERE is_placeholder;
