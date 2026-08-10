-- Storefront Integration — WCFM multi-vendor order routing (Discovery report,
-- 2026-08-10). A WooCommerce order can carry line items from several WCFM
-- vendors; each vendor's items must reserve stock from that vendor's own
-- warehouse instead of one shared warehouse for the whole order.
--
-- Two additive, backward-compatible changes:
--
--   1. order_items.warehouse_id (nullable) — the per-line warehouse resolved
--      at storefront-ingestion time (via the vendor mapping below), read back
--      by the stock-reservation step at status-transition time (a SEPARATE
--      later operation from order creation — see orders.repository.ts
--      applyStockEffect). NULL for every order created before this migration
--      and for every non-storefront (manual/CSV/bulk) order created after it:
--      those keep using the existing single order-level `orders.warehouse_id`
--      exactly as before. This column is populated ONLY by the storefront
--      ingestion path, and only when the connection has vendor mappings
--      configured — never a required field.
--
--   2. storefront_connection_vendor_warehouses — an explicit, admin-managed
--      mapping `(connection_id, external_vendor_id) -> warehouse_id`. No
--      warehouse is ever auto-created here; an unmapped vendor fails the
--      ingestion event closed (no silent fallback), by design.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. order_items.warehouse_id — nullable, so every existing row and every
--    non-storefront order stays exactly as it is today.
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN warehouse_id uuid;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.order_items.warehouse_id IS
  'Per-line warehouse override (storefront multi-vendor routing). NULL means '
  '"use the order''s single warehouse_id", the pre-existing behavior for '
  'every manual/CSV/bulk order and every order created before this column '
  'existed. Set only by storefront ingestion, only when the connection has '
  'vendor->warehouse mappings configured for the order''s vendors.';

CREATE INDEX order_items_warehouse_idx
  ON public.order_items (warehouse_id) WHERE warehouse_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. storefront_connection_vendor_warehouses — explicit admin-managed
--    mapping. Composite natural key (connection_id, external_vendor_id):
--    the same WooCommerce vendor id is meaningless across two different
--    connections (different stores), so the mapping is scoped per connection,
--    not per company.
-- ---------------------------------------------------------------------------
CREATE TABLE public.storefront_connection_vendor_warehouses (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL,
  connection_id      uuid        NOT NULL,
  external_vendor_id text        NOT NULL,
  warehouse_id       uuid        NOT NULL,
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefront_connection_vendor_warehouses_pkey PRIMARY KEY (id),
  CONSTRAINT storefront_connection_vendor_warehouses_vendor_check
    CHECK (char_length(external_vendor_id) BETWEEN 1 AND 200),
  CONSTRAINT storefront_connection_vendor_warehouses_unique
    UNIQUE (connection_id, external_vendor_id),
  CONSTRAINT storefront_connection_vendor_warehouses_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT storefront_connection_vendor_warehouses_connection_fk FOREIGN KEY (connection_id)
    REFERENCES public.storefront_connections (id) ON DELETE CASCADE,
  CONSTRAINT storefront_connection_vendor_warehouses_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.storefront_connection_vendor_warehouses IS
  'Explicit, admin-managed WCFM/marketplace vendor -> CRM warehouse routing '
  'for one storefront connection. No row here is ever created automatically '
  '(no auto-provisioned warehouse) — an unmapped vendor fails the ingestion '
  'event closed rather than falling back silently.';

CREATE INDEX storefront_connection_vendor_warehouses_connection_idx
  ON public.storefront_connection_vendor_warehouses (connection_id);

CREATE TRIGGER storefront_connection_vendor_warehouses_touch_updated_at
  BEFORE UPDATE ON public.storefront_connection_vendor_warehouses
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.storefront_connection_vendor_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_connection_vendor_warehouses FORCE  ROW LEVEL SECURITY;

CREATE POLICY storefront_connection_vendor_warehouses_tenant
  ON public.storefront_connection_vendor_warehouses
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
