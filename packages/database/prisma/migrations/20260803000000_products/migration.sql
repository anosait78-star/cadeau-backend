-- EPIC-8 — Products.
--
-- The product catalog, built on the EPIC-7 master data (categories, units).
-- Two tenant-editable tables, both with base columns + FORCE RLS by company_id
-- (per docs/core-data.md §16.2) and the `touch_updated_at` trigger:
--
--   1. products — a catalog item. Optionally classified by a
--      `product_categories` row and measured in a `units` row (both EPIC-7,
--      same tenant). Unique per company by name.
--
--   2. product_variants — a concrete sellable unit under a product, carrying
--      `sku`, `barcode`, and the moving-average `average_cost` (integer minor
--      units — api-conventions §money). `average_cost` is DERIVED from receipts
--      (EPIC-13) and never set by clients; it starts at 0. `company_id` is
--      denormalized onto the variant so RLS scopes it directly (the same tenant
--      as its parent product).
--
-- Deletes are soft (archive: `is_active = false`) so historical orders / COGS
-- keep resolving their product + variant references. Forward-only.
-- Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. products — catalog items (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.products (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  name        text        NOT NULL,
  description text,
  category_id uuid,
  unit_id     uuid,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_company_name_key UNIQUE (company_id, name),
  CONSTRAINT products_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT products_category_fk FOREIGN KEY (category_id)
    REFERENCES public.product_categories (id) ON DELETE SET NULL,
  CONSTRAINT products_unit_fk FOREIGN KEY (unit_id)
    REFERENCES public.units (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.products IS
  'Product catalog items (EPIC-8). Tenant-editable; archived via is_active.';

CREATE INDEX products_keyset_idx ON public.products (company_id, name, id);
CREATE INDEX products_created_keyset_idx ON public.products (company_id, created_at DESC, id DESC);
CREATE INDEX products_category_idx ON public.products (category_id);
CREATE INDEX products_unit_idx ON public.products (unit_id);

CREATE TRIGGER products_touch_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE  ROW LEVEL SECURITY;

CREATE POLICY products_tenant ON public.products
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. product_variants — sellable units under a product (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.product_variants (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL,
  product_id   uuid        NOT NULL,
  name         text        NOT NULL,
  sku          text,
  barcode      text,
  -- Moving-average cost in integer minor units (api-conventions §money).
  -- Derived from receipts (EPIC-13); never written by API clients.
  average_cost bigint      NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_pkey PRIMARY KEY (id),
  CONSTRAINT product_variants_product_name_key UNIQUE (product_id, name),
  CONSTRAINT product_variants_average_cost_check CHECK (average_cost >= 0),
  CONSTRAINT product_variants_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT product_variants_product_fk FOREIGN KEY (product_id)
    REFERENCES public.products (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.product_variants IS
  'Product variants / SKUs (EPIC-8). Tenant-editable; average_cost derived (EPIC-13).';

-- SKU / barcode are unique per company when present (partial unique indexes:
-- multiple NULLs are allowed, so variants without a code do not collide).
CREATE UNIQUE INDEX product_variants_company_sku_key
  ON public.product_variants (company_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX product_variants_company_barcode_key
  ON public.product_variants (company_id, barcode) WHERE barcode IS NOT NULL;

CREATE INDEX product_variants_product_idx ON public.product_variants (product_id, name, id);
CREATE INDEX product_variants_company_keyset_idx
  ON public.product_variants (company_id, created_at DESC, id DESC);

CREATE TRIGGER product_variants_touch_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants FORCE  ROW LEVEL SECURITY;

CREATE POLICY product_variants_tenant ON public.product_variants
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
