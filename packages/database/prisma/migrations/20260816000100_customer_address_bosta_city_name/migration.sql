-- Bosta's `POST /deliveries` requires a free-text `city` name alongside the
-- district id (its schema requires both, even though the id is what actually
-- drives routing) — capture it at picker time (Phase C) alongside the ids
-- added in the previous migration, so nothing has to be re-derived later.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.customer_addresses
  ADD COLUMN bosta_city_name text NULL;
