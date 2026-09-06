-- Storefront order sync (address / payment / gift-wrap, discovery 2026-09-06):
-- fields needed to sync a storefront order's delivery address, online-payment
-- status, and gift-wrap request into the CRM. All additive/nullable or
-- zero-defaulted — no existing row or code path changes behavior.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- Customer addresses: which addresses came from a storefront sync (never
-- silently overwritten once a human has edited them), plus the storefront's
-- own unmapped city/governorate text for staff review.
ALTER TABLE public.customer_addresses
  ADD COLUMN source     text NOT NULL DEFAULT 'manual',
  ADD COLUMN raw_city   text NULL,
  ADD COLUMN raw_state  text NULL;

-- Governorates: the Arabic display name, for exact-match lookup against a
-- storefront's own checkout dropdown values (never fuzzy-matched).
ALTER TABLE public.governorates
  ADD COLUMN name_ar text NULL;

-- Orders: gift-wrap request + fee, added into `total` alongside `shipping_fee`.
ALTER TABLE public.orders
  ADD COLUMN is_gift_wrap        boolean NOT NULL DEFAULT false,
  ADD COLUMN gift_wrap_fee_minor bigint  NOT NULL DEFAULT 0;
