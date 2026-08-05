-- EPIC-10 — Customers (M10.1).
--
-- The customer base: a person identified by a phone number, with zero or more
-- delivery addresses and a set of KPIs that EPIC-11 will compute.
--
-- Tables (both tenant-editable: base columns + FORCE RLS by company_id per
-- docs/core-data.md §16.2, plus the `app.touch_updated_at()` trigger):
--
--   1. customers          — profile + derived KPIs. Phone is stored TWICE:
--                           `phone_encrypted` (AES-256-GCM, reversible) and
--                           `phone_hash` (HMAC-SHA256 blind index) which carries
--                           the per-company uniqueness rule and the exact lookup.
--   2. customer_addresses — 0..n per customer; at most one default each.
--
-- Why two phone columns (owner decision D1, docs/privacy-model.md):
-- GCM uses a fresh random IV per write, so the same number never encrypts to the
-- same token — safe, but unusable as an index key. The blind index is the keyed,
-- deterministic companion: it can be UNIQUE and looked up, reveals only equality,
-- and is rebuildable from the ciphertext when the key rotates. NO plaintext phone
-- column exists, by design.
--
-- KPI columns (`orders_count`, `total_spent`, `last_order_at`) are DERIVED: they
-- ship here with safe defaults and no write path, and EPIC-11 begins maintaining
-- them once orders exist. Money is integer minor units (bigint), never a float.
--
-- `idempotency_key` mirrors the EPIC-9 pattern (decision D4): unique per company
-- when present, so a retried `Idempotency-Key` create replays the stored row.
--
-- Customer MERGE is deliberately absent (decision D3) — it lands in EPIC-11 so it
-- can be written once against the complete set of customer-owned tables.
--
-- Deletes are soft (`is_active = false`); rows stay so history keeps resolving.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. customers — the customer base (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.customers (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  name            text        NOT NULL,
  -- AES-256-GCM token of the E.164 phone (@cadeau/crypto). Source of truth.
  phone_encrypted text        NOT NULL,
  -- HMAC-SHA256 blind index of the SAME normalized E.164 value, 64 hex chars.
  phone_hash      text        NOT NULL,
  email           citext,
  notes           text,
  -- Derived KPIs (EPIC-11 writes these; nothing in EPIC-10 does).
  orders_count    integer     NOT NULL DEFAULT 0,
  total_spent     bigint      NOT NULL DEFAULT 0,
  last_order_at   timestamptz,
  idempotency_key text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id),
  -- The E.164 uniqueness rule, enforced over the blind index. Scoped PER COMPANY,
  -- not globally: two tenants may each know the same person, and a global unique
  -- index would leak a customer's existence across the tenant boundary.
  CONSTRAINT customers_company_phone_key UNIQUE (company_id, phone_hash),
  CONSTRAINT customers_name_check CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT customers_phone_hash_check CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customers_notes_check CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT customers_orders_count_check CHECK (orders_count >= 0),
  CONSTRAINT customers_total_spent_check CHECK (total_spent >= 0),
  CONSTRAINT customers_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.customers IS
  'Customer base (EPIC-10). Tenant-editable; archived via is_active.';
COMMENT ON COLUMN public.customers.phone_encrypted IS
  'AES-256-GCM token of the E.164 phone; the source of truth. Never plaintext.';
COMMENT ON COLUMN public.customers.phone_hash IS
  'HMAC-SHA256 blind index of the normalized E.164 phone (docs/privacy-model.md). '
  'Carries per-company uniqueness and exact lookup; reveals equality only.';
COMMENT ON COLUMN public.customers.orders_count IS
  'Derived (EPIC-11). No write path in EPIC-10.';
COMMENT ON COLUMN public.customers.total_spent IS
  'Derived (EPIC-11), integer minor units. No write path in EPIC-10.';
COMMENT ON COLUMN public.customers.last_order_at IS
  'Derived (EPIC-11). No write path in EPIC-10.';

-- A retried create with the same Idempotency-Key replays instead of duplicating.
CREATE UNIQUE INDEX customers_idempotency_key
  ON public.customers (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Keyset covering indexes for the two whitelisted sorts.
CREATE INDEX customers_created_keyset_idx
  ON public.customers (company_id, created_at DESC, id DESC);
CREATE INDEX customers_name_keyset_idx ON public.customers (company_id, name, id);

CREATE TRIGGER customers_touch_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE  ROW LEVEL SECURITY;

CREATE POLICY customers_tenant ON public.customers
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. customer_addresses — delivery addresses (tenant-editable).
-- ---------------------------------------------------------------------------
-- `line` is encrypted: a delivery address is high-sensitivity PII and is never
-- searched, so it needs no blind index (docs/privacy-model.md §7).
CREATE TABLE public.customer_addresses (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL,
  customer_id    uuid        NOT NULL,
  line_encrypted text        NOT NULL,
  landmark       text,
  notes          text,
  governorate_id uuid,
  is_default     boolean     NOT NULL DEFAULT false,
  is_active      boolean     NOT NULL DEFAULT true,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_addresses_pkey PRIMARY KEY (id),
  CONSTRAINT customer_addresses_landmark_check
    CHECK (landmark IS NULL OR char_length(landmark) <= 200),
  CONSTRAINT customer_addresses_notes_check
    CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT customer_addresses_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT customer_addresses_customer_fk FOREIGN KEY (customer_id)
    REFERENCES public.customers (id) ON DELETE CASCADE,
  CONSTRAINT customer_addresses_governorate_fk FOREIGN KEY (governorate_id)
    REFERENCES public.governorates (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.customer_addresses IS
  'Customer delivery addresses (EPIC-10). Tenant-editable; archived via is_active.';
COMMENT ON COLUMN public.customer_addresses.line_encrypted IS
  'AES-256-GCM token of the address line; never plaintext, never searched.';

-- At most one default address per customer.
CREATE UNIQUE INDEX customer_addresses_customer_default_key
  ON public.customer_addresses (customer_id) WHERE is_default;

CREATE INDEX customer_addresses_customer_idx
  ON public.customer_addresses (customer_id, created_at DESC, id DESC);
CREATE INDEX customer_addresses_keyset_idx
  ON public.customer_addresses (company_id, created_at DESC, id DESC);
CREATE INDEX customer_addresses_governorate_idx
  ON public.customer_addresses (governorate_id);

CREATE TRIGGER customer_addresses_touch_updated_at
  BEFORE UPDATE ON public.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses FORCE  ROW LEVEL SECURITY;

CREATE POLICY customer_addresses_tenant ON public.customer_addresses
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
