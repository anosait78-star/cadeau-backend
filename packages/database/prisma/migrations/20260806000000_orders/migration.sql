-- EPIC-11 — Orders (M11.1).
--
-- The core of the system: a 12-state order lifecycle plus a separate follow-up
-- axis, per-order items with frozen cost snapshots (COGS), a per-order
-- append-only activity log, and a pivotal COD `collected_amount`.
--
-- Tables (all tenant-editable: base columns + FORCE RLS by company_id per
-- docs/core-data.md §16.2, plus the `app.touch_updated_at()` trigger unless the
-- table is append-only):
--
--   1. order_sequences  — one row per company; the monotonic order-number
--                          counter. `UPDATE … RETURNING next_number` under the
--                          tenant transaction serializes number issuance so
--                          concurrent creates never collide.
--   2. orders           — header: number, customer, assignee, 12-state `status`
--                          + separate `follow_up_state`, label/reason/governorate
--                          (EPIC-7), money (subtotal/shipping/discount/total) and
--                          the pivotal `collected_amount`. Money is integer minor
--                          units (bigint), never a float.
--   3. order_items       — variant lines with a `cost_snapshot` (the variant's
--                          moving-average cost frozen at add time — stable COGS).
--   4. order_activities  — append-only per-order log (created/status/assign/…).
--
-- Also: `stock_reservations.order_id` gains a real FK now that `orders` exists
-- (EPIC-9 left it as a bare column). Customer KPI columns (orders_count /
-- total_spent / last_order_at) shipped in EPIC-10 with no write path; EPIC-11's
-- application layer begins maintaining them in-transaction (owner decision D3).
--
-- Amounts: total = subtotal + shipping_fee − discount (enforced by a CHECK).
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. order_sequences — per-company monotonic order-number counter.
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_sequences (
  company_id  uuid        NOT NULL,
  next_number bigint      NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_sequences_pkey PRIMARY KEY (company_id),
  CONSTRAINT order_sequences_next_number_check CHECK (next_number >= 1),
  CONSTRAINT order_sequences_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.order_sequences IS
  'Per-company order-number counter (EPIC-11). One row per company; '
  'UPDATE … RETURNING serializes number issuance.';

ALTER TABLE public.order_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_sequences FORCE  ROW LEVEL SECURITY;

CREATE POLICY order_sequences_tenant ON public.order_sequences
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. orders — the order header (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.orders (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL,
  order_number     bigint      NOT NULL,
  customer_id      uuid        NOT NULL,
  assignee_id      uuid,
  status           text        NOT NULL DEFAULT 'new',
  follow_up_state  text        NOT NULL DEFAULT 'none',
  label_id         uuid,
  reason_id        uuid,
  governorate_id   uuid,
  subtotal         bigint      NOT NULL DEFAULT 0,
  shipping_fee     bigint      NOT NULL DEFAULT 0,
  discount         bigint      NOT NULL DEFAULT 0,
  total            bigint      NOT NULL DEFAULT 0,
  collected_amount bigint      NOT NULL DEFAULT 0,
  payment_status   text        NOT NULL DEFAULT 'unpaid',
  notes            text,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key  text,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  -- The 12-state lifecycle (docs/epic-11-design.md §6).
  CONSTRAINT orders_status_check CHECK (status IN (
    'new','confirming','processing','incomplete','ready','shipped',
    'delivered','completed','postponed','cancelled','returned','exchanged'
  )),
  CONSTRAINT orders_follow_up_check CHECK (follow_up_state IN (
    'none','pending','contacted','scheduled','no_answer'
  )),
  CONSTRAINT orders_payment_status_check CHECK (payment_status IN (
    'unpaid','partial','paid'
  )),
  CONSTRAINT orders_number_check    CHECK (order_number >= 1),
  CONSTRAINT orders_subtotal_check  CHECK (subtotal >= 0),
  CONSTRAINT orders_shipping_check  CHECK (shipping_fee >= 0),
  CONSTRAINT orders_discount_check  CHECK (discount >= 0),
  CONSTRAINT orders_collected_check CHECK (collected_amount >= 0),
  -- Money identity: total is always the derived sum.
  CONSTRAINT orders_total_check     CHECK (total = subtotal + shipping_fee - discount),
  CONSTRAINT orders_notes_check     CHECK (notes IS NULL OR char_length(notes) <= 2000),
  -- The per-company human-facing number is unique.
  CONSTRAINT orders_company_number_key UNIQUE (company_id, order_number),
  CONSTRAINT orders_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  -- The customer is PINNED: an order always resolves its customer.
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id)
    REFERENCES public.customers (id) ON DELETE RESTRICT,
  CONSTRAINT orders_assignee_fk FOREIGN KEY (assignee_id)
    REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT orders_label_fk FOREIGN KEY (label_id)
    REFERENCES public.order_labels (id) ON DELETE SET NULL,
  CONSTRAINT orders_reason_fk FOREIGN KEY (reason_id)
    REFERENCES public.order_reasons (id) ON DELETE SET NULL,
  CONSTRAINT orders_governorate_fk FOREIGN KEY (governorate_id)
    REFERENCES public.governorates (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.orders IS
  'Order header (EPIC-11). Tenant-editable. 12-state status + separate follow-up.';
COMMENT ON COLUMN public.orders.collected_amount IS
  'COD money actually collected, integer minor units. Drives payment_status and '
  'the customer total_spent KPI.';
COMMENT ON COLUMN public.orders.total IS
  'Derived: subtotal + shipping_fee - discount (enforced by orders_total_check).';

-- A retried create with the same Idempotency-Key replays instead of duplicating.
CREATE UNIQUE INDEX orders_idempotency_key
  ON public.orders (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Keyset covering indexes for the two whitelisted sorts, plus the status-tab
-- counts and the customer/assignee lookups.
CREATE INDEX orders_created_keyset_idx
  ON public.orders (company_id, created_at DESC, id DESC);
CREATE INDEX orders_updated_keyset_idx
  ON public.orders (company_id, updated_at DESC, id DESC);
CREATE INDEX orders_status_idx   ON public.orders (company_id, status);
CREATE INDEX orders_customer_idx ON public.orders (customer_id, created_at DESC, id DESC);
CREATE INDEX orders_assignee_idx ON public.orders (assignee_id);

CREATE TRIGGER orders_touch_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE  ROW LEVEL SECURITY;

CREATE POLICY orders_tenant ON public.orders
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 3. order_items — variant lines with a frozen cost snapshot (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_items (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL,
  order_id      uuid        NOT NULL,
  variant_id    uuid        NOT NULL,
  name_snapshot text        NOT NULL,
  quantity      bigint      NOT NULL,
  price         bigint      NOT NULL DEFAULT 0,
  cost_snapshot bigint      NOT NULL DEFAULT 0,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT order_items_price_check    CHECK (price >= 0),
  CONSTRAINT order_items_cost_check     CHECK (cost_snapshot >= 0),
  CONSTRAINT order_items_name_check     CHECK (char_length(name_snapshot) BETWEEN 1 AND 300),
  CONSTRAINT order_items_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE CASCADE,
  -- The variant is PINNED: line COGS/labels stay resolvable.
  CONSTRAINT order_items_variant_fk FOREIGN KEY (variant_id)
    REFERENCES public.product_variants (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.order_items IS
  'Order line items (EPIC-11). cost_snapshot freezes the variant averageCost at '
  'add time so COGS is stable.';

CREATE INDEX order_items_order_idx  ON public.order_items (order_id);
CREATE INDEX order_items_keyset_idx ON public.order_items (company_id, created_at DESC, id DESC);
CREATE INDEX order_items_variant_idx ON public.order_items (variant_id);

CREATE TRIGGER order_items_touch_updated_at
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE  ROW LEVEL SECURITY;

CREATE POLICY order_items_tenant ON public.order_items
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 4. order_activities — append-only per-order activity log (tenant-scoped).
-- ---------------------------------------------------------------------------
-- Append-only: no touch_updated_at trigger, no updated_at column. Rows carry
-- ids/labels only — never customer PII (docs/privacy-model.md §6).
CREATE TABLE public.order_activities (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  order_id   uuid        NOT NULL,
  kind       text        NOT NULL,
  from_value text,
  to_value   text,
  note       text,
  actor_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_activities_pkey PRIMARY KEY (id),
  CONSTRAINT order_activities_kind_check CHECK (kind IN (
    'created','status_changed','assigned','edited','payment','item_added',
    'item_removed','follow_up_changed','merged'
  )),
  CONSTRAINT order_activities_note_check CHECK (note IS NULL OR char_length(note) <= 2000),
  CONSTRAINT order_activities_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT order_activities_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE CASCADE,
  CONSTRAINT order_activities_actor_fk FOREIGN KEY (actor_id)
    REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.order_activities IS
  'Append-only per-order activity log (EPIC-11). ids/labels only, never PII.';

CREATE INDEX order_activities_order_keyset_idx
  ON public.order_activities (order_id, created_at DESC, id DESC);
CREATE INDEX order_activities_keyset_idx
  ON public.order_activities (company_id, created_at DESC, id DESC);

ALTER TABLE public.order_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_activities FORCE  ROW LEVEL SECURITY;

CREATE POLICY order_activities_tenant ON public.order_activities
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 5. stock_reservations.order_id — promote to a real FK now that orders exist.
-- ---------------------------------------------------------------------------
-- EPIC-9 shipped `order_id` as a bare uuid column ("no FK until orders exist").
-- Orders exist now, so add referential integrity. SET NULL: archiving/removing
-- an order must not delete its historical reservation rows.
ALTER TABLE public.stock_reservations
  ADD CONSTRAINT stock_reservations_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE SET NULL;

CREATE INDEX stock_reservations_order_idx
  ON public.stock_reservations (order_id);
