-- EPIC-7 — Master Data.
--
-- Shared reference data every later module builds on, served as a cached,
-- authoritative source (feature key `master-data`, gated by the three-layer
-- access model). Two kinds of table, mirroring the EPIC-5 split:
--
--   1. SYSTEM REFERENCE (not tenant-scoped): currencies, country_configs,
--      governorates. Product reference data — the same in every tenant — written
--      only by the idempotent system seed and readable by anyone for lookups.
--      RLS: public SELECT (`USING (true)`) + writes only in the null-principal
--      seed context (`app.current_user_id() IS NULL`) — the same pattern the
--      EPIC-5 catalog uses, so the running app can never mutate this data.
--
--   2. TENANT-EDITABLE (base columns + FORCE RLS by company_id, per
--      docs/core-data.md §16.2): units, product_categories, order_labels,
--      order_reasons, shipping_zones. Each company curates its own rows.
--
-- Deletes are soft (`is_active = false`) so historical references never break.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. currencies — ISO-4217 catalog (system reference). PK = code.
-- ---------------------------------------------------------------------------
CREATE TABLE public.currencies (
  code           text        NOT NULL,
  name           text        NOT NULL,
  symbol         text        NOT NULL,
  decimal_digits integer     NOT NULL DEFAULT 2,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currencies_pkey PRIMARY KEY (code),
  CONSTRAINT currencies_decimal_digits_check CHECK (decimal_digits BETWEEN 0 AND 6)
);

COMMENT ON TABLE public.currencies IS
  'Currency catalog (EPIC-7, ISO-4217). System reference data.';

CREATE TRIGGER currencies_touch_updated_at
  BEFORE UPDATE ON public.currencies
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currencies FORCE  ROW LEVEL SECURITY;

CREATE POLICY currencies_read ON public.currencies
  FOR SELECT USING (true);
CREATE POLICY currencies_seed ON public.currencies
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 2. country_configs — ISO-3166 alpha-2 catalog (system reference). PK = code.
-- ---------------------------------------------------------------------------
CREATE TABLE public.country_configs (
  code                  text        NOT NULL,
  name                  text        NOT NULL,
  default_currency_code text        NOT NULL,
  phone_code            text        NOT NULL,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT country_configs_pkey PRIMARY KEY (code),
  CONSTRAINT country_configs_currency_fk FOREIGN KEY (default_currency_code)
    REFERENCES public.currencies (code) ON DELETE RESTRICT
);

COMMENT ON TABLE public.country_configs IS
  'Country configuration (EPIC-7, ISO-3166 alpha-2). System reference data.';

CREATE INDEX country_configs_currency_idx ON public.country_configs (default_currency_code);

CREATE TRIGGER country_configs_touch_updated_at
  BEFORE UPDATE ON public.country_configs
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.country_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_configs FORCE  ROW LEVEL SECURITY;

CREATE POLICY country_configs_read ON public.country_configs
  FOR SELECT USING (true);
CREATE POLICY country_configs_seed ON public.country_configs
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 3. governorates — administrative regions per country (system reference).
-- ---------------------------------------------------------------------------
CREATE TABLE public.governorates (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  country_code text        NOT NULL,
  name         text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT governorates_pkey PRIMARY KEY (id),
  CONSTRAINT governorates_country_name_key UNIQUE (country_code, name),
  CONSTRAINT governorates_country_fk FOREIGN KEY (country_code)
    REFERENCES public.country_configs (code) ON DELETE CASCADE
);

COMMENT ON TABLE public.governorates IS
  'Governorates / administrative regions (EPIC-7). System reference data.';

CREATE INDEX governorates_keyset_idx ON public.governorates (country_code, name, id);

CREATE TRIGGER governorates_touch_updated_at
  BEFORE UPDATE ON public.governorates
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.governorates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governorates FORCE  ROW LEVEL SECURITY;

CREATE POLICY governorates_read ON public.governorates
  FOR SELECT USING (true);
CREATE POLICY governorates_seed ON public.governorates
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 4. units — units of measure (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.units (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  name       text        NOT NULL,
  code       text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT units_pkey PRIMARY KEY (id),
  CONSTRAINT units_company_name_key UNIQUE (company_id, name),
  CONSTRAINT units_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.units IS
  'Units of measure (EPIC-7). Tenant-editable master data.';

CREATE INDEX units_keyset_idx ON public.units (company_id, name, id);
CREATE INDEX units_created_keyset_idx ON public.units (company_id, created_at DESC, id DESC);

CREATE TRIGGER units_touch_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units FORCE  ROW LEVEL SECURITY;

CREATE POLICY units_tenant ON public.units
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 5. product_categories — self-nesting categories (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.product_categories (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  name       text        NOT NULL,
  parent_id  uuid,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_categories_pkey PRIMARY KEY (id),
  CONSTRAINT product_categories_company_name_key UNIQUE (company_id, name),
  CONSTRAINT product_categories_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT product_categories_parent_fk FOREIGN KEY (parent_id)
    REFERENCES public.product_categories (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.product_categories IS
  'Product categories (EPIC-7). Tenant-editable, self-nesting via parent_id.';

CREATE INDEX product_categories_keyset_idx ON public.product_categories (company_id, name, id);
CREATE INDEX product_categories_created_keyset_idx ON public.product_categories (company_id, created_at DESC, id DESC);
CREATE INDEX product_categories_parent_idx ON public.product_categories (parent_id);

CREATE TRIGGER product_categories_touch_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories FORCE  ROW LEVEL SECURITY;

CREATE POLICY product_categories_tenant ON public.product_categories
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 6. order_labels — order tags (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_labels (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  name       text        NOT NULL,
  color      text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_labels_pkey PRIMARY KEY (id),
  CONSTRAINT order_labels_company_name_key UNIQUE (company_id, name),
  CONSTRAINT order_labels_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.order_labels IS
  'Order labels / tags (EPIC-7). Tenant-editable master data.';

CREATE INDEX order_labels_keyset_idx ON public.order_labels (company_id, name, id);
CREATE INDEX order_labels_created_keyset_idx ON public.order_labels (company_id, created_at DESC, id DESC);

CREATE TRIGGER order_labels_touch_updated_at
  BEFORE UPDATE ON public.order_labels
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.order_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_labels FORCE  ROW LEVEL SECURITY;

CREATE POLICY order_labels_tenant ON public.order_labels
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 7. order_reasons — reasons grouped by kind (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_reasons (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  name       text        NOT NULL,
  kind       text        NOT NULL DEFAULT 'general',
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_reasons_pkey PRIMARY KEY (id),
  CONSTRAINT order_reasons_company_kind_name_key UNIQUE (company_id, kind, name),
  CONSTRAINT order_reasons_kind_check CHECK (kind IN ('cancellation', 'return', 'general')),
  CONSTRAINT order_reasons_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.order_reasons IS
  'Order reasons (EPIC-7), grouped by kind. Tenant-editable master data.';

CREATE INDEX order_reasons_keyset_idx ON public.order_reasons (company_id, name, id);
CREATE INDEX order_reasons_created_keyset_idx ON public.order_reasons (company_id, created_at DESC, id DESC);

CREATE TRIGGER order_reasons_touch_updated_at
  BEFORE UPDATE ON public.order_reasons
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.order_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_reasons FORCE  ROW LEVEL SECURITY;

CREATE POLICY order_reasons_tenant ON public.order_reasons
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 8. shipping_zones — shipping groupings (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.shipping_zones (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL,
  name         text        NOT NULL,
  country_code text,
  is_active    boolean     NOT NULL DEFAULT true,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_zones_pkey PRIMARY KEY (id),
  CONSTRAINT shipping_zones_company_name_key UNIQUE (company_id, name),
  CONSTRAINT shipping_zones_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.shipping_zones IS
  'Shipping zones (EPIC-7). Tenant-editable master data.';

CREATE INDEX shipping_zones_keyset_idx ON public.shipping_zones (company_id, name, id);
CREATE INDEX shipping_zones_created_keyset_idx ON public.shipping_zones (company_id, created_at DESC, id DESC);

CREATE TRIGGER shipping_zones_touch_updated_at
  BEFORE UPDATE ON public.shipping_zones
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.shipping_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_zones FORCE  ROW LEVEL SECURITY;

CREATE POLICY shipping_zones_tenant ON public.shipping_zones
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
