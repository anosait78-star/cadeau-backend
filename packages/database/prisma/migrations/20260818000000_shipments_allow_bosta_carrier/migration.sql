-- `shipments_carrier_check` (20260807000000_shipping) only ever allowed
-- 'manual'. `carrier_connections` (20260815000000) added real Bosta
-- connections and `BostaCarrierAdapter`/`CarrierRouter` route new shipments
-- to `carrier = 'bosta'` whenever a company has an active Bosta connection —
-- but the check constraint was never widened, so every such insert fails
-- with a 23514 check-violation (surfaced to the client as a bare 500).
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.shipments DROP CONSTRAINT shipments_carrier_check;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_carrier_check CHECK (carrier IN ('manual', 'bosta'));
