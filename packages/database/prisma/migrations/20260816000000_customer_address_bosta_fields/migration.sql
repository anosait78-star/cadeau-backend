-- Real Bosta integration (Phase B): the customer-address fields Bosta's
-- `dropOffAddress` needs (their own city/district ids — not our internal
-- `governorate_id`). Nullable; `BostaCarrierAdapter` refuses to ship rather
-- than guess a city when these are unset (no format guessing, matches the
-- CSV importer's convention elsewhere in this codebase).
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.customer_addresses
  ADD COLUMN bosta_city_id     text NULL,
  ADD COLUMN bosta_district_id text NULL;
