-- Remember the name the storefront last told us for a vendor (2026-10-19).
--
-- Vendors arrived under names belonging to other registrations: one
-- registration's values leaked into another's on the storefront side, and the
-- CRM recorded whatever it was handed. Staff then fixed the warehouse names by
-- hand. The storefront fix is in place, but re-sending a vendor still has to
-- be safe: renaming on every repeat would wipe out those corrections.
--
-- This column is what lets the two be told apart. When the warehouse still
-- carries the name we were last told, nobody has touched it and a new name may
-- replace it; when it differs, a human renamed it and their name stands.
--
-- Nullable, with no backfill: for every mapping made before today we genuinely
-- do not know what we were told, and guessing would license overwriting the
-- very corrections this column exists to protect.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.storefront_connection_vendor_warehouses
  ADD COLUMN last_vendor_name text;

COMMENT ON COLUMN public.storefront_connection_vendor_warehouses.last_vendor_name IS
  'The vendor name the storefront last sent. A warehouse still carrying it has not been renamed by staff, so a later send may replace it. Null for mappings made before this column existed.';
