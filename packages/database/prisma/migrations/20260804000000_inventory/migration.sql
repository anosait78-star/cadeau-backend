-- EPIC-9 — Inventory & Warehouses.
--
-- Stock locations and per-variant stock levels, with the four write paths that
-- may move stock — reserve, release, transfer, adjust — each executed inside a
-- single transaction so the level and its log row commit together.
--
-- Tables (all tenant-editable: base columns + FORCE RLS by company_id per
-- docs/core-data.md §16.2, plus the `app.touch_updated_at()` trigger):
--
--   1. warehouses        — a stock location. At most one default per company.
--   2. inventory_stock   — (warehouse, variant) → on_hand / committed /
--                          available / reorder_point. `available` is DERIVED
--                          (`on_hand - committed`) and kept as a real column by
--                          the `app.sync_stock_available()` trigger so it can be
--                          filtered, sorted, and indexed (keyset).
--   3. stock_reservations — an outstanding commitment against a level.
--   4. stock_transfers    — an atomic move between two warehouses (log).
--   5. stock_adjustments  — a reason-coded correction to on_hand (log).
--
-- Quantities are whole units (bigint), never money. `products.allow_oversell`
-- is the per-product oversell policy the reserve path consults.
--
-- The three write logs carry an optional `idempotency_key`, unique per company
-- and per operation, so a retried `Idempotency-Key` request replays the stored
-- result instead of moving stock twice (api-conventions §Idempotency).
--
-- Logs are append-only in practice (never deleted by the API); levels are
-- updated in place. Forward-only.
-- Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 0. Oversell policy on the EPIC-8 catalog.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN allow_oversell boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.allow_oversell IS
  'Oversell policy (EPIC-9): when true, reservations may exceed available stock.';

-- ---------------------------------------------------------------------------
-- 1. warehouses — stock locations (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.warehouses (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  name       text        NOT NULL,
  code       text,
  address    text,
  is_default boolean     NOT NULL DEFAULT false,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_pkey PRIMARY KEY (id),
  CONSTRAINT warehouses_company_name_key UNIQUE (company_id, name),
  CONSTRAINT warehouses_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.warehouses IS
  'Stock locations (EPIC-9). Tenant-editable; archived via is_active.';

-- A code is optional but unique per company when present.
CREATE UNIQUE INDEX warehouses_company_code_key
  ON public.warehouses (company_id, code) WHERE code IS NOT NULL;

-- At most one default warehouse per company.
CREATE UNIQUE INDEX warehouses_company_default_key
  ON public.warehouses (company_id) WHERE is_default;

CREATE INDEX warehouses_keyset_idx ON public.warehouses (company_id, name, id);
CREATE INDEX warehouses_created_keyset_idx
  ON public.warehouses (company_id, created_at DESC, id DESC);

CREATE TRIGGER warehouses_touch_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses FORCE  ROW LEVEL SECURITY;

CREATE POLICY warehouses_tenant ON public.warehouses
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. inventory_stock — per-(warehouse, variant) levels (tenant-editable).
-- ---------------------------------------------------------------------------

-- Keeps the derived `available` column in lock-step with its inputs. Writers
-- never set `available` themselves, so it cannot drift from on_hand/committed.
CREATE OR REPLACE FUNCTION app.sync_stock_available()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.available := NEW.on_hand - NEW.committed;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app.sync_stock_available() IS
  'Maintains inventory_stock.available = on_hand - committed (EPIC-9).';

CREATE TABLE public.inventory_stock (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL,
  warehouse_id  uuid        NOT NULL,
  variant_id    uuid        NOT NULL,
  on_hand       bigint      NOT NULL DEFAULT 0,
  committed     bigint      NOT NULL DEFAULT 0,
  -- Derived from on_hand/committed by app.sync_stock_available(); never client-set.
  available     bigint      NOT NULL DEFAULT 0,
  reorder_point bigint      NOT NULL DEFAULT 0,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_stock_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_stock_warehouse_variant_key UNIQUE (warehouse_id, variant_id),
  CONSTRAINT inventory_stock_on_hand_check CHECK (on_hand >= 0),
  CONSTRAINT inventory_stock_committed_check CHECK (committed >= 0),
  CONSTRAINT inventory_stock_reorder_point_check CHECK (reorder_point >= 0),
  CONSTRAINT inventory_stock_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT inventory_stock_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE CASCADE,
  CONSTRAINT inventory_stock_variant_fk FOREIGN KEY (variant_id)
    REFERENCES public.product_variants (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.inventory_stock IS
  'Per-(warehouse, variant) stock levels (EPIC-9). available is derived.';

CREATE INDEX inventory_stock_available_keyset_idx
  ON public.inventory_stock (company_id, available, id);
CREATE INDEX inventory_stock_updated_keyset_idx
  ON public.inventory_stock (company_id, updated_at DESC, id DESC);
CREATE INDEX inventory_stock_variant_idx ON public.inventory_stock (variant_id);

CREATE TRIGGER inventory_stock_sync_available
  BEFORE INSERT OR UPDATE ON public.inventory_stock
  FOR EACH ROW EXECUTE FUNCTION app.sync_stock_available();

CREATE TRIGGER inventory_stock_touch_updated_at
  BEFORE UPDATE ON public.inventory_stock
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock FORCE  ROW LEVEL SECURITY;

CREATE POLICY inventory_stock_tenant ON public.inventory_stock
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 3. stock_reservations — outstanding commitments (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_reservations (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  warehouse_id    uuid        NOT NULL,
  variant_id      uuid        NOT NULL,
  quantity        bigint      NOT NULL,
  -- The order this reservation backs (EPIC-11); no FK until orders exist.
  order_id        uuid,
  reference       text,
  status          text        NOT NULL DEFAULT 'active',
  released_at     timestamptz,
  idempotency_key text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_reservations_pkey PRIMARY KEY (id),
  CONSTRAINT stock_reservations_quantity_check CHECK (quantity > 0),
  CONSTRAINT stock_reservations_status_check CHECK (status IN ('active', 'released')),
  CONSTRAINT stock_reservations_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT stock_reservations_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE CASCADE,
  CONSTRAINT stock_reservations_variant_fk FOREIGN KEY (variant_id)
    REFERENCES public.product_variants (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.stock_reservations IS
  'Outstanding stock commitments (EPIC-9); released atomically against committed.';

CREATE UNIQUE INDEX stock_reservations_idempotency_key
  ON public.stock_reservations (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX stock_reservations_keyset_idx
  ON public.stock_reservations (company_id, created_at DESC, id DESC);
CREATE INDEX stock_reservations_status_idx ON public.stock_reservations (company_id, status);
CREATE INDEX stock_reservations_variant_idx ON public.stock_reservations (variant_id);

CREATE TRIGGER stock_reservations_touch_updated_at
  BEFORE UPDATE ON public.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations FORCE  ROW LEVEL SECURITY;

CREATE POLICY stock_reservations_tenant ON public.stock_reservations
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 4. stock_transfers — atomic moves between warehouses (log).
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_transfers (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL,
  from_warehouse_id uuid        NOT NULL,
  to_warehouse_id   uuid        NOT NULL,
  variant_id        uuid        NOT NULL,
  quantity          bigint      NOT NULL,
  note              text,
  idempotency_key   text,
  created_by        uuid,
  updated_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_pkey PRIMARY KEY (id),
  CONSTRAINT stock_transfers_quantity_check CHECK (quantity > 0),
  CONSTRAINT stock_transfers_distinct_check CHECK (from_warehouse_id <> to_warehouse_id),
  CONSTRAINT stock_transfers_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT stock_transfers_from_fk FOREIGN KEY (from_warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE CASCADE,
  CONSTRAINT stock_transfers_to_fk FOREIGN KEY (to_warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE CASCADE,
  CONSTRAINT stock_transfers_variant_fk FOREIGN KEY (variant_id)
    REFERENCES public.product_variants (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.stock_transfers IS
  'Atomic stock moves between warehouses (EPIC-9); the durable transfer log.';

CREATE UNIQUE INDEX stock_transfers_idempotency_key
  ON public.stock_transfers (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX stock_transfers_keyset_idx
  ON public.stock_transfers (company_id, created_at DESC, id DESC);
CREATE INDEX stock_transfers_variant_idx ON public.stock_transfers (variant_id);

CREATE TRIGGER stock_transfers_touch_updated_at
  BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers FORCE  ROW LEVEL SECURITY;

CREATE POLICY stock_transfers_tenant ON public.stock_transfers
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 5. stock_adjustments — reason-coded corrections (log).
-- ---------------------------------------------------------------------------
CREATE TABLE public.stock_adjustments (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  warehouse_id    uuid        NOT NULL,
  variant_id      uuid        NOT NULL,
  -- Signed: positive raises on_hand, negative lowers it. Never zero.
  quantity_delta  bigint      NOT NULL,
  reason          text        NOT NULL,
  note            text,
  idempotency_key text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id),
  CONSTRAINT stock_adjustments_delta_check CHECK (quantity_delta <> 0),
  CONSTRAINT stock_adjustments_reason_check
    CHECK (reason IN ('count', 'damage', 'loss', 'return', 'other')),
  CONSTRAINT stock_adjustments_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT stock_adjustments_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE CASCADE,
  CONSTRAINT stock_adjustments_variant_fk FOREIGN KEY (variant_id)
    REFERENCES public.product_variants (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.stock_adjustments IS
  'Reason-coded stock corrections (EPIC-9); the durable adjustment log.';

CREATE UNIQUE INDEX stock_adjustments_idempotency_key
  ON public.stock_adjustments (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX stock_adjustments_keyset_idx
  ON public.stock_adjustments (company_id, created_at DESC, id DESC);
CREATE INDEX stock_adjustments_variant_idx ON public.stock_adjustments (variant_id);

CREATE TRIGGER stock_adjustments_touch_updated_at
  BEFORE UPDATE ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments FORCE  ROW LEVEL SECURITY;

CREATE POLICY stock_adjustments_tenant ON public.stock_adjustments
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
