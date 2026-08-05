-- EPIC-13 — Finance & Compliance (M13.1).
--
-- Suppliers & purchase orders (atomic receipt raises stock and rolls
-- product_variants.average_cost), unified expenses, configurable VAT,
-- official invoices (PDF rendered by the application layer), refunds,
-- working shipping reconciliation, and an atomic sequential monthly close.
-- Decisions D1-D7 (docs/epic-13-design.md §4):
--
--   D1 — pdfkit renders invoice PDFs (application-layer concern; no schema
--        impact). D2 — finance.read/finance.manage only (access-catalog
--        generator, no new permission keys). D3 — VAT lives in a
--        finance-owned tax_settings table, never on companies. D4 —
--        accounting_periods enforces sequential, gap-free close. D5 —
--        shipping reconciliation is header + lines, matched by tracking
--        number. D6 — cash center/P&L are computed reads; no ledger table
--        here. D7 — purchase_order_receipt is the write path for
--        product_variants.average_cost, forward-referenced since EPIC-8.
--
-- 16 tables, all tenant-editable (base columns + FORCE RLS by company_id per
-- docs/core-data.md §16.2), except four append-only child log rows
-- (purchase_order_receipt_lines, invoice_lines, shipping_reconciliation_lines)
-- which follow the audit_log SELECT/INSERT-only RLS pattern — no update path,
-- so no updated_at/trigger either.
--
-- Money is integer minor units (bigint), never a float, matching every prior
-- epic. Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 0. Widen stock_adjustments.reason (EPIC-9) to accept the PO-receipt reason
--    code this epic writes (D7). Forward-only: a new constraint, not an edit
--    to the EPIC-9 migration file.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_adjustments DROP CONSTRAINT stock_adjustments_reason_check;
ALTER TABLE public.stock_adjustments ADD CONSTRAINT stock_adjustments_reason_check
  CHECK (reason IN ('count', 'damage', 'loss', 'return', 'other', 'purchase_receipt'));

-- ---------------------------------------------------------------------------
-- 1. suppliers — reference entity (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.suppliers (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  name       text        NOT NULL,
  phone      text,
  email      text,
  address    text,
  tax_id     text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_pkey PRIMARY KEY (id),
  CONSTRAINT suppliers_name_check CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT suppliers_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.suppliers IS
  'A goods/services supplier (EPIC-13). Tenant-editable; archived via is_active.';

CREATE INDEX suppliers_keyset_idx ON public.suppliers (company_id, name, id);
CREATE INDEX suppliers_created_keyset_idx ON public.suppliers (company_id, created_at DESC, id DESC);

CREATE TRIGGER suppliers_touch_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE  ROW LEVEL SECURITY;

CREATE POLICY suppliers_tenant ON public.suppliers
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. purchase_order_sequences — per-company monotonic PO-number counter, same
--    discipline as order_sequences (EPIC-11).
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_order_sequences (
  company_id  uuid        NOT NULL,
  next_number bigint      NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_sequences_pkey PRIMARY KEY (company_id),
  CONSTRAINT purchase_order_sequences_next_number_check CHECK (next_number >= 1),
  CONSTRAINT purchase_order_sequences_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.purchase_order_sequences IS
  'Per-company PO-number counter (EPIC-13). UPDATE … RETURNING serializes issuance.';

ALTER TABLE public.purchase_order_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_sequences FORCE  ROW LEVEL SECURITY;

CREATE POLICY purchase_order_sequences_tenant ON public.purchase_order_sequences
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 3. purchase_orders — header (tenant-editable). The supplier is PINNED.
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_orders (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  supplier_id     uuid        NOT NULL,
  number          bigint      NOT NULL,
  status          text        NOT NULL DEFAULT 'draft',
  expected_date   timestamptz,
  notes           text,
  idempotency_key text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_orders_status_check CHECK (status IN (
    'draft','ordered','partially_received','received','cancelled'
  )),
  CONSTRAINT purchase_orders_company_number_key UNIQUE (company_id, number),
  CONSTRAINT purchase_orders_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT purchase_orders_supplier_fk FOREIGN KEY (supplier_id)
    REFERENCES public.suppliers (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.purchase_orders IS
  'A purchase order (EPIC-13): draft → ordered → partially_received → received → cancelled. Supplier is PINNED.';

CREATE UNIQUE INDEX purchase_orders_idempotency_key
  ON public.purchase_orders (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX purchase_orders_created_keyset_idx ON public.purchase_orders (company_id, created_at DESC, id DESC);
CREATE INDEX purchase_orders_status_idx ON public.purchase_orders (company_id, status);
CREATE INDEX purchase_orders_supplier_idx ON public.purchase_orders (supplier_id);

CREATE TRIGGER purchase_orders_touch_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders FORCE  ROW LEVEL SECURITY;

CREATE POLICY purchase_orders_tenant ON public.purchase_orders
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 4. purchase_order_lines — a variant, ordered/received quantity, unit cost.
--    The variant is PINNED. quantity_received rolls up on receipt.
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_order_lines (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL,
  po_id             uuid        NOT NULL,
  variant_id        uuid        NOT NULL,
  quantity_ordered  bigint      NOT NULL,
  quantity_received bigint      NOT NULL DEFAULT 0,
  unit_cost         bigint      NOT NULL,
  created_by        uuid,
  updated_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_lines_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_order_lines_qty_ordered_check CHECK (quantity_ordered > 0),
  CONSTRAINT purchase_order_lines_qty_received_check CHECK (
    quantity_received >= 0 AND quantity_received <= quantity_ordered
  ),
  CONSTRAINT purchase_order_lines_unit_cost_check CHECK (unit_cost >= 0),
  CONSTRAINT purchase_order_lines_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_lines_po_fk FOREIGN KEY (po_id)
    REFERENCES public.purchase_orders (id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_lines_variant_fk FOREIGN KEY (variant_id)
    REFERENCES public.product_variants (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.purchase_order_lines IS
  'A PO line (EPIC-13): variant, ordered/received quantity, unit cost. Variant is PINNED.';

CREATE INDEX purchase_order_lines_po_idx ON public.purchase_order_lines (po_id);
CREATE INDEX purchase_order_lines_variant_idx ON public.purchase_order_lines (variant_id);

CREATE TRIGGER purchase_order_lines_touch_updated_at
  BEFORE UPDATE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines FORCE  ROW LEVEL SECURITY;

CREATE POLICY purchase_order_lines_tenant ON public.purchase_order_lines
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 5. purchase_order_receipts — one atomic stock-raising event per receipt.
--    The PO and warehouse are PINNED.
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_order_receipts (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  po_id           uuid        NOT NULL,
  warehouse_id    uuid        NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_receipts_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_order_receipts_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_receipts_po_fk FOREIGN KEY (po_id)
    REFERENCES public.purchase_orders (id) ON DELETE RESTRICT,
  CONSTRAINT purchase_order_receipts_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.purchase_order_receipts IS
  'An atomic PO receipt (EPIC-13): raises inventory_stock.on_hand and rolls product_variants.average_cost.';

CREATE UNIQUE INDEX purchase_order_receipts_idempotency_key
  ON public.purchase_order_receipts (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX purchase_order_receipts_keyset_idx ON public.purchase_order_receipts (company_id, created_at DESC, id DESC);
CREATE INDEX purchase_order_receipts_po_idx ON public.purchase_order_receipts (po_id);

CREATE TRIGGER purchase_order_receipts_touch_updated_at
  BEFORE UPDATE ON public.purchase_order_receipts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.purchase_order_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipts FORCE  ROW LEVEL SECURITY;

CREATE POLICY purchase_order_receipts_tenant ON public.purchase_order_receipts
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 6. purchase_order_receipt_lines — append-only (audit_log RLS pattern: no
--    UPDATE/DELETE policy, no updated_at/trigger).
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_order_receipt_lines (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  receipt_id  uuid        NOT NULL,
  po_line_id  uuid        NOT NULL,
  quantity    bigint      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_receipt_lines_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_order_receipt_lines_quantity_check CHECK (quantity > 0),
  CONSTRAINT purchase_order_receipt_lines_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_receipt_lines_receipt_fk FOREIGN KEY (receipt_id)
    REFERENCES public.purchase_order_receipts (id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_receipt_lines_po_line_fk FOREIGN KEY (po_line_id)
    REFERENCES public.purchase_order_lines (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.purchase_order_receipt_lines IS
  'Append-only receipt lines (EPIC-13): quantity received against one PO line.';

CREATE INDEX purchase_order_receipt_lines_receipt_idx ON public.purchase_order_receipt_lines (receipt_id);
CREATE INDEX purchase_order_receipt_lines_po_line_idx ON public.purchase_order_receipt_lines (po_line_id);

ALTER TABLE public.purchase_order_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipt_lines FORCE  ROW LEVEL SECURITY;

CREATE POLICY purchase_order_receipt_lines_tenant_select ON public.purchase_order_receipt_lines
  FOR SELECT
  USING (company_id = app.current_company_id());

CREATE POLICY purchase_order_receipt_lines_tenant_insert ON public.purchase_order_receipt_lines
  FOR INSERT
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 7. purchase_order_payments — a (partial) payment against a PO.
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_order_payments (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  po_id           uuid        NOT NULL,
  amount_minor    bigint      NOT NULL,
  method          text        NOT NULL,
  paid_at         timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_payments_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_order_payments_amount_check CHECK (amount_minor > 0),
  CONSTRAINT purchase_order_payments_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_payments_po_fk FOREIGN KEY (po_id)
    REFERENCES public.purchase_orders (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.purchase_order_payments IS
  'A (partial) payment against a purchase order (EPIC-13).';

CREATE UNIQUE INDEX purchase_order_payments_idempotency_key
  ON public.purchase_order_payments (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX purchase_order_payments_keyset_idx ON public.purchase_order_payments (company_id, created_at DESC, id DESC);
CREATE INDEX purchase_order_payments_po_idx ON public.purchase_order_payments (po_id);

CREATE TRIGGER purchase_order_payments_touch_updated_at
  BEFORE UPDATE ON public.purchase_order_payments
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.purchase_order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_payments FORCE  ROW LEVEL SECURITY;

CREATE POLICY purchase_order_payments_tenant ON public.purchase_order_payments
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 8. expenses — unified, categorized money-out records. Supplier soft-detaches.
-- ---------------------------------------------------------------------------
CREATE TABLE public.expenses (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  category        text        NOT NULL,
  amount_minor    bigint      NOT NULL,
  incurred_at     timestamptz NOT NULL DEFAULT now(),
  notes           text,
  supplier_id     uuid,
  idempotency_key text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_amount_check CHECK (amount_minor > 0),
  CONSTRAINT expenses_category_check CHECK (char_length(category) BETWEEN 1 AND 100),
  CONSTRAINT expenses_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT expenses_supplier_fk FOREIGN KEY (supplier_id)
    REFERENCES public.suppliers (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.expenses IS
  'A unified, categorized expense (EPIC-13). supplier_id is optional and soft-detaches.';

CREATE UNIQUE INDEX expenses_idempotency_key
  ON public.expenses (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX expenses_keyset_idx ON public.expenses (company_id, incurred_at DESC, id DESC);
CREATE INDEX expenses_category_idx ON public.expenses (company_id, category);
CREATE INDEX expenses_supplier_idx ON public.expenses (supplier_id);

CREATE TRIGGER expenses_touch_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE  ROW LEVEL SECURITY;

CREATE POLICY expenses_tenant ON public.expenses
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 9. tax_settings — one row per company, the configured VAT rate (D3).
-- ---------------------------------------------------------------------------
CREATE TABLE public.tax_settings (
  company_id              uuid        NOT NULL,
  vat_rate_bps            integer     NOT NULL DEFAULT 0,
  vat_registration_number text,
  updated_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_settings_pkey PRIMARY KEY (company_id),
  CONSTRAINT tax_settings_vat_rate_check CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT tax_settings_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.tax_settings IS
  'One row per company: the configured VAT rate in basis points (EPIC-13, D3).';

ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_settings FORCE  ROW LEVEL SECURITY;

CREATE POLICY tax_settings_tenant ON public.tax_settings
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE TRIGGER tax_settings_touch_updated_at
  BEFORE UPDATE ON public.tax_settings
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 10. invoice_sequences — per-company monotonic invoice-number counter.
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoice_sequences (
  company_id  uuid        NOT NULL,
  next_number bigint      NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_sequences_pkey PRIMARY KEY (company_id),
  CONSTRAINT invoice_sequences_next_number_check CHECK (next_number >= 1),
  CONSTRAINT invoice_sequences_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.invoice_sequences IS
  'Per-company invoice-number counter (EPIC-13). UPDATE … RETURNING serializes issuance.';

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences FORCE  ROW LEVEL SECURITY;

CREATE POLICY invoice_sequences_tenant ON public.invoice_sequences
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 11. invoices — an official VAT invoice, PDF rendered by the application
--     layer (D1). vat_rate_bps_snapshot freezes the rate used at issue time.
--     order_id is nullable (manual invoices allowed) and RESTRICTed.
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoices (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL,
  order_id               uuid,
  number                 bigint      NOT NULL,
  subtotal_minor         bigint      NOT NULL,
  vat_minor              bigint      NOT NULL,
  total_minor            bigint      NOT NULL,
  vat_rate_bps_snapshot  integer     NOT NULL,
  pdf_generated_at       timestamptz,
  idempotency_key        text,
  created_by             uuid,
  updated_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_subtotal_check CHECK (subtotal_minor >= 0),
  CONSTRAINT invoices_vat_check CHECK (vat_minor >= 0),
  CONSTRAINT invoices_total_check CHECK (total_minor = subtotal_minor + vat_minor),
  CONSTRAINT invoices_company_number_key UNIQUE (company_id, number),
  CONSTRAINT invoices_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT invoices_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.invoices IS
  'An official VAT invoice (EPIC-13). PDF rendered server-side (pdfkit, D1); vat_rate_bps_snapshot freezes the rate.';

CREATE UNIQUE INDEX invoices_idempotency_key
  ON public.invoices (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX invoices_created_keyset_idx ON public.invoices (company_id, created_at DESC, id DESC);
CREATE INDEX invoices_order_idx ON public.invoices (order_id);

CREATE TRIGGER invoices_touch_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE  ROW LEVEL SECURITY;

CREATE POLICY invoices_tenant ON public.invoices
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 12. invoice_lines — append-only (audit_log RLS pattern).
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoice_lines (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL,
  invoice_id        uuid        NOT NULL,
  description       text        NOT NULL,
  quantity          bigint      NOT NULL,
  unit_price_minor  bigint      NOT NULL,
  line_total_minor  bigint      NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_lines_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_lines_quantity_check CHECK (quantity > 0),
  CONSTRAINT invoice_lines_unit_price_check CHECK (unit_price_minor >= 0),
  CONSTRAINT invoice_lines_total_check CHECK (line_total_minor = quantity * unit_price_minor),
  CONSTRAINT invoice_lines_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT invoice_lines_invoice_fk FOREIGN KEY (invoice_id)
    REFERENCES public.invoices (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.invoice_lines IS
  'Append-only invoice line items (EPIC-13).';

CREATE INDEX invoice_lines_invoice_idx ON public.invoice_lines (invoice_id);

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines FORCE  ROW LEVEL SECURITY;

CREATE POLICY invoice_lines_tenant_select ON public.invoice_lines
  FOR SELECT
  USING (company_id = app.current_company_id());

CREATE POLICY invoice_lines_tenant_insert ON public.invoice_lines
  FOR INSERT
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 13. refunds — money out against a prior invoice and/or order.
--     idempotency_key is MANDATORY (money-moving, irreversible).
-- ---------------------------------------------------------------------------
CREATE TABLE public.refunds (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  invoice_id      uuid,
  order_id        uuid,
  amount_minor    bigint      NOT NULL,
  reason          text        NOT NULL,
  idempotency_key text        NOT NULL,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_pkey PRIMARY KEY (id),
  CONSTRAINT refunds_amount_check CHECK (amount_minor > 0),
  CONSTRAINT refunds_reason_check CHECK (char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT refunds_idempotency_key UNIQUE (company_id, idempotency_key),
  CONSTRAINT refunds_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT refunds_invoice_fk FOREIGN KEY (invoice_id)
    REFERENCES public.invoices (id) ON DELETE RESTRICT,
  CONSTRAINT refunds_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.refunds IS
  'A refund (EPIC-13): money out against a prior invoice/order. idempotency_key is mandatory.';

CREATE INDEX refunds_keyset_idx ON public.refunds (company_id, created_at DESC, id DESC);
CREATE INDEX refunds_invoice_idx ON public.refunds (invoice_id);
CREATE INDEX refunds_order_idx ON public.refunds (order_id);

CREATE TRIGGER refunds_touch_updated_at
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds FORCE  ROW LEVEL SECURITY;

CREATE POLICY refunds_tenant ON public.refunds
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 14. shipping_reconciliations — header (D5): a reconciled carrier statement
--     batch.
-- ---------------------------------------------------------------------------
CREATE TABLE public.shipping_reconciliations (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL,
  carrier                text        NOT NULL,
  statement_ref          text        NOT NULL,
  period_key             text        NOT NULL,
  total_statement_minor  bigint      NOT NULL,
  total_fee_minor        bigint      NOT NULL,
  total_variance_minor   bigint      NOT NULL,
  idempotency_key        text,
  created_by             uuid,
  updated_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_reconciliations_pkey PRIMARY KEY (id),
  CONSTRAINT shipping_reconciliations_variance_check CHECK (
    total_variance_minor = total_statement_minor - total_fee_minor
  ),
  CONSTRAINT shipping_reconciliations_period_check CHECK (period_key ~ '^\d{4}-\d{2}$'),
  CONSTRAINT shipping_reconciliations_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.shipping_reconciliations IS
  'A reconciled carrier statement batch (EPIC-13, D5): statement lines matched to shipments by tracking number.';

CREATE UNIQUE INDEX shipping_reconciliations_idempotency_key
  ON public.shipping_reconciliations (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX shipping_reconciliations_keyset_idx ON public.shipping_reconciliations (company_id, created_at DESC, id DESC);
CREATE INDEX shipping_reconciliations_carrier_period_idx ON public.shipping_reconciliations (company_id, carrier, period_key);

CREATE TRIGGER shipping_reconciliations_touch_updated_at
  BEFORE UPDATE ON public.shipping_reconciliations
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.shipping_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_reconciliations FORCE  ROW LEVEL SECURITY;

CREATE POLICY shipping_reconciliations_tenant ON public.shipping_reconciliations
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 15. shipping_reconciliation_lines — append-only (audit_log RLS pattern).
--     The shipment is PINNED.
-- ---------------------------------------------------------------------------
CREATE TABLE public.shipping_reconciliation_lines (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL,
  reconciliation_id       uuid        NOT NULL,
  shipment_id             uuid        NOT NULL,
  statement_amount_minor  bigint      NOT NULL,
  shipment_fee_minor      bigint      NOT NULL,
  variance_minor          bigint      NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_reconciliation_lines_pkey PRIMARY KEY (id),
  CONSTRAINT shipping_reconciliation_lines_variance_check CHECK (
    variance_minor = statement_amount_minor - shipment_fee_minor
  ),
  CONSTRAINT shipping_reconciliation_lines_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT shipping_reconciliation_lines_reconciliation_fk FOREIGN KEY (reconciliation_id)
    REFERENCES public.shipping_reconciliations (id) ON DELETE CASCADE,
  CONSTRAINT shipping_reconciliation_lines_shipment_fk FOREIGN KEY (shipment_id)
    REFERENCES public.shipments (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.shipping_reconciliation_lines IS
  'Append-only reconciliation lines (EPIC-13, D5): one shipment''s statement amount vs. its recorded fee.';

CREATE INDEX shipping_reconciliation_lines_reconciliation_idx ON public.shipping_reconciliation_lines (reconciliation_id);
CREATE INDEX shipping_reconciliation_lines_shipment_idx ON public.shipping_reconciliation_lines (shipment_id);

ALTER TABLE public.shipping_reconciliation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_reconciliation_lines FORCE  ROW LEVEL SECURITY;

CREATE POLICY shipping_reconciliation_lines_tenant_select ON public.shipping_reconciliation_lines
  FOR SELECT
  USING (company_id = app.current_company_id());

CREATE POLICY shipping_reconciliation_lines_tenant_insert ON public.shipping_reconciliation_lines
  FOR INSERT
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 16. accounting_periods — atomic sequential monthly close (D4). Once closed,
--     the application layer rejects a dated write inside it (every
--     money-moving finance service checks this table first).
-- ---------------------------------------------------------------------------
CREATE TABLE public.accounting_periods (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  period_key  text        NOT NULL,
  status      text        NOT NULL DEFAULT 'open',
  closed_at   timestamptz,
  closed_by   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_periods_pkey PRIMARY KEY (id),
  CONSTRAINT accounting_periods_status_check CHECK (status IN ('open','closed')),
  CONSTRAINT accounting_periods_period_check CHECK (period_key ~ '^\d{4}-\d{2}$'),
  CONSTRAINT accounting_periods_closed_consistency_check CHECK (
    (status = 'closed' AND closed_at IS NOT NULL) OR (status = 'open' AND closed_at IS NULL)
  ),
  CONSTRAINT accounting_periods_company_period_key UNIQUE (company_id, period_key),
  CONSTRAINT accounting_periods_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.accounting_periods IS
  'A monthly accounting period (EPIC-13, D4). Close is atomic and sequential: no gaps.';

CREATE INDEX accounting_periods_keyset_idx ON public.accounting_periods (company_id, period_key);

CREATE TRIGGER accounting_periods_touch_updated_at
  BEFORE UPDATE ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_periods FORCE  ROW LEVEL SECURITY;

CREATE POLICY accounting_periods_tenant ON public.accounting_periods
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
