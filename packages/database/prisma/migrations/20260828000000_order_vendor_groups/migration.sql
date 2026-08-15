-- Vendor Accounts — Phase 2 (order vendor groups). A vendor's slice of one
-- order: one row per (order, warehouse) pair found among that order's
-- existing `order_items.warehouse_id` routing (storefront multi-vendor
-- routing, already shipped — no change to that column or to how it is
-- populated). Purely additive and read-through: rows are computed and
-- upserted idempotently by `OrdersService.listVendorGroups` when queried, not
-- tied to any order status transition. `status` defaults to 'new' and is
-- reserved for a later phase's per-vendor lifecycle — nothing reads or
-- enforces it yet. The Parent Order's own `status`/transition machine is
-- completely untouched by this migration.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

CREATE TABLE public.order_vendor_groups (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL,
  order_id     uuid        NOT NULL,
  warehouse_id uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'new',
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_vendor_groups_pkey PRIMARY KEY (id),
  CONSTRAINT order_vendor_groups_order_warehouse_key UNIQUE (order_id, warehouse_id),
  CONSTRAINT order_vendor_groups_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT order_vendor_groups_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE CASCADE,
  CONSTRAINT order_vendor_groups_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.order_vendor_groups IS
  'A vendor''s slice of one order (Vendor Accounts, Phase 2): one row per '
  '(order, warehouse) pair among that order''s order_items.warehouse_id '
  'routing. Materialized idempotently on read, not tied to any order status '
  'transition. status is reserved for a later phase''s per-vendor lifecycle.';

CREATE INDEX order_vendor_groups_order_idx
  ON public.order_vendor_groups (company_id, order_id);

CREATE INDEX order_vendor_groups_warehouse_idx
  ON public.order_vendor_groups (warehouse_id);

CREATE TRIGGER order_vendor_groups_touch_updated_at
  BEFORE UPDATE ON public.order_vendor_groups
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.order_vendor_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_vendor_groups FORCE  ROW LEVEL SECURITY;

CREATE POLICY order_vendor_groups_tenant
  ON public.order_vendor_groups
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
