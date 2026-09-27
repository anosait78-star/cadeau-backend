-- Where a manual order came from (2026-09-27).
--
-- Staff take orders over Facebook, WhatsApp, TikTok, Instagram and the phone,
-- and the system had nowhere to record which — so "where do our orders come
-- from?" could only be answered from memory. `sales_channel` holds one of a
-- fixed set of keys, validated in the API (never a free-text field the
-- database has to police).
--
-- Additive and nullable, with no backfill: an order placed before today
-- genuinely has no recorded channel, and guessing one would invent history.
-- Orders arriving from the storefront set it themselves from now on; older
-- storefront orders stay null like every other old row.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.orders
  ADD COLUMN sales_channel text;

COMMENT ON COLUMN public.orders.sales_channel IS
  'Where the order came from: facebook | whatsapp | tiktok | instagram | phone | storefront. Null on orders placed before this column existed, and on manual orders where staff did not say.';
