-- Fix orders_total_check (storefront-order-sync follow-up, 2026-09-06):
-- the previous migration added gift_wrap_fee_minor to `total`'s application-
-- level formula but forgot this DB-level CHECK constraint still enforced the
-- OLD formula (total = subtotal + shipping_fee - discount) -- any order with
-- a nonzero gift-wrap fee failed to save with a check-constraint violation.
--
-- Safe for existing rows: gift_wrap_fee_minor defaults to 0, so the new
-- formula is identical to the old one for every row that predates this
-- feature.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.orders DROP CONSTRAINT orders_total_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_total_check
  CHECK (total = subtotal + shipping_fee + gift_wrap_fee_minor - discount);

COMMENT ON COLUMN public.orders.total IS
  'Derived: subtotal + shipping_fee + gift_wrap_fee_minor - discount (enforced by orders_total_check).';
