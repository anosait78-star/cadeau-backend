-- Orders: add a per-order warehouse commitment, selectable at create time, so
-- stock reservation at the `processing` transition can target the order's
-- chosen warehouse instead of always resolving the company default.
-- Nullable: existing orders and any caller that omits it are unaffected —
-- applyStockEffect() falls back to defaultWarehouse() when null.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.orders
  ADD COLUMN warehouse_id uuid NULL;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE SET NULL;

CREATE INDEX orders_warehouse_idx ON public.orders (warehouse_id);
