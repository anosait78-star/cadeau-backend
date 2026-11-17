-- Vendor payouts (2026-11-17): what the company owes each vendor for the
-- products it sells on their behalf, and how that debt is settled.
--
-- Three pieces:
--
-- 1. `product_variants.wholesale_cost_minor` — the price the company pays the
--    vendor per unit. Deliberately NOT `average_cost`: that one is a moving
--    average DERIVED from purchase-order receipts and is never client-written,
--    while this one is entered by staff. NULL means "not priced yet", which
--    is different from a real zero.
--
-- 2. `vendor_ledger_entries` — an append-only ledger per vendor warehouse.
--    A row is written in the same transaction that moves an order into
--    `delivered` (one `accrual` per vendor line) or from `delivered`/
--    `completed` into `returned` (one `return_reversal` mirroring it), plus
--    manual `adjustment`s by a manager. Each row freezes its own copy of the
--    line (variant, name, quantity, unit cost), so a later edit to the order
--    can never change what was owed. The only rows ever updated are those
--    still flagged `needs_pricing` (a vendor line delivered before its
--    variant had a wholesale price) and only while no payout holds them.
--
-- 3. `vendor_payouts` — a company's request to pay a vendor everything owed
--    at that moment. Creating one links every open, priced ledger row of
--    that warehouse to it; the vendor confirming receipt (or a manager
--    forcing confirmation with a written reason) settles exactly those rows;
--    cancelling unlinks them. At most one payout per warehouse is pending.
--
-- Both tables are warehouse-scoped the same way as `message_threads`
-- (EPIC-17): staff (unscoped) see every row of their company, a vendor sees
-- only their own warehouse's rows — enforced here, not only in the service.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. Wholesale cost on the variant.
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_variants
  ADD COLUMN wholesale_cost_minor bigint;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_wholesale_cost_check
  CHECK (wholesale_cost_minor IS NULL OR wholesale_cost_minor >= 0);

COMMENT ON COLUMN public.product_variants.wholesale_cost_minor IS
  'What the company pays the vendor per unit, integer minor units. NULL = not priced yet. Staff-entered; unrelated to average_cost.';

-- ---------------------------------------------------------------------------
-- 2. vendor_payouts (created first: ledger rows reference it).
-- ---------------------------------------------------------------------------
CREATE TABLE public.vendor_payouts (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL,
  warehouse_id       uuid        NOT NULL,
  amount_minor       bigint      NOT NULL,
  method             text        NOT NULL,
  reference          text,
  notes              text,
  status             text        NOT NULL DEFAULT 'pending',
  confirmation_kind  text,
  force_reason       text,
  confirmed_by       uuid,
  confirmed_at       timestamptz,
  cancelled_by       uuid,
  cancelled_at       timestamptz,
  idempotency_key    text        NOT NULL,
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_payouts_pkey PRIMARY KEY (id),

  CONSTRAINT vendor_payouts_amount_check CHECK (amount_minor > 0),
  CONSTRAINT vendor_payouts_method_check
    CHECK (method IN ('cash', 'bank_transfer', 'instapay', 'wallet', 'other')),
  CONSTRAINT vendor_payouts_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  CONSTRAINT vendor_payouts_reference_check
    CHECK (reference IS NULL OR char_length(reference) BETWEEN 1 AND 200),
  CONSTRAINT vendor_payouts_notes_check
    CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 1000),
  -- A confirmed payout says who confirmed it and how; a forced one says why.
  CONSTRAINT vendor_payouts_confirmed_check CHECK (
    (status = 'confirmed') = (confirmed_at IS NOT NULL AND confirmation_kind IS NOT NULL)
  ),
  CONSTRAINT vendor_payouts_confirmation_kind_check
    CHECK (confirmation_kind IS NULL OR confirmation_kind IN ('vendor', 'forced')),
  CONSTRAINT vendor_payouts_force_reason_check CHECK (
    (confirmation_kind IS NOT DISTINCT FROM 'forced') = (force_reason IS NOT NULL)
    AND (force_reason IS NULL OR char_length(force_reason) BETWEEN 3 AND 500)
  ),
  CONSTRAINT vendor_payouts_cancelled_check
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),

  CONSTRAINT vendor_payouts_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT vendor_payouts_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT,
  CONSTRAINT vendor_payouts_confirmed_by_fk FOREIGN KEY (confirmed_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT vendor_payouts_cancelled_by_fk FOREIGN KEY (cancelled_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT vendor_payouts_created_by_fk FOREIGN KEY (created_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT vendor_payouts_updated_by_fk FOREIGN KEY (updated_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL,

  CONSTRAINT vendor_payouts_idempotency_key UNIQUE (company_id, idempotency_key)
);

COMMENT ON TABLE public.vendor_payouts IS
  'A request to pay one vendor everything owed when it was created. Settled when the vendor confirms receipt (or a manager forces it).';

-- One pending payout per vendor: two overlapping requests would fight over
-- the same ledger rows.
CREATE UNIQUE INDEX vendor_payouts_one_pending_idx
  ON public.vendor_payouts (warehouse_id)
  WHERE status = 'pending';

CREATE INDEX vendor_payouts_warehouse_keyset_idx
  ON public.vendor_payouts (warehouse_id, created_at DESC, id DESC);

CREATE INDEX vendor_payouts_company_keyset_idx
  ON public.vendor_payouts (company_id, created_at DESC, id DESC);

-- Cash center reads confirmed payouts by confirmation date.
CREATE INDEX vendor_payouts_confirmed_idx
  ON public.vendor_payouts (company_id, confirmed_at)
  WHERE status = 'confirmed';

CREATE TRIGGER vendor_payouts_touch_updated_at
  BEFORE UPDATE ON public.vendor_payouts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.vendor_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payouts FORCE  ROW LEVEL SECURITY;

CREATE POLICY vendor_payouts_tenant ON public.vendor_payouts
  USING (
    company_id = app.current_company_id()
    AND (
      app.current_member_warehouse_id() IS NULL
      OR warehouse_id = app.current_member_warehouse_id()
    )
  )
  WITH CHECK (
    company_id = app.current_company_id()
    AND (
      app.current_member_warehouse_id() IS NULL
      OR warehouse_id = app.current_member_warehouse_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. vendor_ledger_entries.
-- ---------------------------------------------------------------------------
CREATE TABLE public.vendor_ledger_entries (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL,
  warehouse_id     uuid        NOT NULL,
  kind             text        NOT NULL,
  order_id         uuid,
  -- Not a foreign key: order lines are deleted and re-inserted when an order's
  -- items are edited, and the ledger row must outlive that. The row keeps its
  -- own copy of what the line said instead.
  order_item_id    uuid,
  variant_id       uuid,
  name_snapshot    text,
  quantity         bigint,
  unit_cost_minor  bigint,
  amount_minor     bigint      NOT NULL,
  needs_pricing    boolean     NOT NULL DEFAULT false,
  payout_id        uuid,
  note             text,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_ledger_entries_pkey PRIMARY KEY (id),

  CONSTRAINT vendor_ledger_entries_kind_check
    CHECK (kind IN ('accrual', 'return_reversal', 'adjustment')),
  -- Order-driven rows carry the full line; an adjustment carries a note and
  -- no line.
  CONSTRAINT vendor_ledger_entries_shape_check CHECK (
    (kind = 'adjustment'
      AND note IS NOT NULL AND char_length(note) BETWEEN 3 AND 500
      AND order_item_id IS NULL AND amount_minor <> 0)
    OR
    (kind <> 'adjustment'
      AND order_id IS NOT NULL AND order_item_id IS NOT NULL
      AND quantity IS NOT NULL AND quantity > 0
      AND unit_cost_minor IS NOT NULL AND unit_cost_minor >= 0)
  ),
  CONSTRAINT vendor_ledger_entries_sign_check CHECK (
    (kind = 'accrual' AND amount_minor >= 0)
    OR (kind = 'return_reversal' AND amount_minor <= 0)
    OR kind = 'adjustment'
  ),
  CONSTRAINT vendor_ledger_entries_pricing_check
    CHECK (NOT needs_pricing OR (kind <> 'adjustment' AND amount_minor = 0)),

  CONSTRAINT vendor_ledger_entries_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT vendor_ledger_entries_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT,
  CONSTRAINT vendor_ledger_entries_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE RESTRICT,
  CONSTRAINT vendor_ledger_entries_variant_fk FOREIGN KEY (variant_id)
    REFERENCES public.product_variants (id) ON DELETE SET NULL,
  CONSTRAINT vendor_ledger_entries_payout_fk FOREIGN KEY (payout_id)
    REFERENCES public.vendor_payouts (id) ON DELETE RESTRICT,
  CONSTRAINT vendor_ledger_entries_created_by_fk FOREIGN KEY (created_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT vendor_ledger_entries_updated_by_fk FOREIGN KEY (updated_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.vendor_ledger_entries IS
  'Append-only per-vendor ledger: accruals at delivery, reversals at return, manual adjustments. Settled by linking to a confirmed vendor_payouts row.';

-- A line accrues once and is reversed at most once, whatever retries or
-- concurrent transitions do.
CREATE UNIQUE INDEX vendor_ledger_entries_line_kind_key
  ON public.vendor_ledger_entries (order_item_id, kind)
  WHERE order_item_id IS NOT NULL;

CREATE INDEX vendor_ledger_entries_warehouse_keyset_idx
  ON public.vendor_ledger_entries (warehouse_id, created_at DESC, id DESC);

-- "Everything this vendor is still owed": the payout-creation scan.
CREATE INDEX vendor_ledger_entries_open_idx
  ON public.vendor_ledger_entries (warehouse_id)
  WHERE payout_id IS NULL;

CREATE INDEX vendor_ledger_entries_payout_idx
  ON public.vendor_ledger_entries (payout_id)
  WHERE payout_id IS NOT NULL;

CREATE INDEX vendor_ledger_entries_order_idx
  ON public.vendor_ledger_entries (order_id)
  WHERE order_id IS NOT NULL;

-- Repricing scan when a variant finally gets a wholesale price.
CREATE INDEX vendor_ledger_entries_needs_pricing_idx
  ON public.vendor_ledger_entries (company_id, variant_id)
  WHERE needs_pricing;

CREATE TRIGGER vendor_ledger_entries_touch_updated_at
  BEFORE UPDATE ON public.vendor_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.vendor_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_ledger_entries FORCE  ROW LEVEL SECURITY;

CREATE POLICY vendor_ledger_entries_tenant ON public.vendor_ledger_entries
  USING (
    company_id = app.current_company_id()
    AND (
      app.current_member_warehouse_id() IS NULL
      OR warehouse_id = app.current_member_warehouse_id()
    )
  )
  WITH CHECK (
    company_id = app.current_company_id()
    AND (
      app.current_member_warehouse_id() IS NULL
      OR warehouse_id = app.current_member_warehouse_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. New notification types: 'vendor_payout.requested' / '.confirmed' /
--    '.cancelled'. Widens the two EPIC-15 closed-set CHECKs. Purely additive.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order.created', 'order.status_changed', 'payment.collected',
    'order_vendor_group.assigned', 'message.received',
    'vendor_payout.requested', 'vendor_payout.confirmed', 'vendor_payout.cancelled'
  ));

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT notification_preferences_type_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_type_check CHECK (type IN (
    'order.created', 'order.status_changed', 'payment.collected',
    'order_vendor_group.assigned', 'message.received',
    'vendor_payout.requested', 'vendor_payout.confirmed', 'vendor_payout.cancelled'
  ));
