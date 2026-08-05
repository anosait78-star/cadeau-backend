-- EPIC-5 — Three-Layer Access (ADR-0003) data model.
--
-- The access model resolves every request against Subscription ∧ Feature-Flag ∧
-- Permission. This migration adds two kinds of table on top of the EPIC-4 auth +
-- tenancy tables:
--
--   1. SYSTEM CATALOG (not tenant-scoped): features, plans, plan_features,
--      permissions, feature_permissions, permission_templates, role_permissions,
--      and the platform_admins grant. This is product reference data — the same
--      in every tenant — written only by the idempotent system seed and readable
--      by anyone for server-side resolution.
--
--   2. TENANT-SCOPED (base columns + FORCE RLS by company_id, per
--      docs/core-data.md §16.2): subscriptions, company_feature_flags, add_ons,
--      member_permissions. Super-Admin writes bind the target company as the
--      active tenant (setTenantContext) so the strict tenant policy holds; the
--      privilege itself is authorized at the app layer (SuperAdminGuard), never
--      by widening RLS.
--
-- RLS design for the catalog:
--   * SELECT is public (`USING (true)`) — the catalog carries no tenant data and
--     the resolver reads it under whatever context the caller happens to have.
--   * Writes (INSERT/UPDATE/DELETE) are permitted ONLY in the system/seed context
--     — when no principal is bound (`app.current_user_id() IS NULL`), exactly the
--     window `prisma db seed` runs in. Every authenticated app request binds a
--     principal, so the app can never mutate the catalog. This mirrors the
--     null-context bootstrap sanctioned for profiles/sessions in M4.2.
--   * platform_admins additionally exposes a self-SELECT so SuperAdminGuard can
--     read the caller's own grant while a principal is bound.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. features — the FEATURE_KEY catalog.
-- ---------------------------------------------------------------------------
CREATE TABLE public.features (
  key         text        NOT NULL,
  name        text        NOT NULL,
  description text,
  category    text        NOT NULL DEFAULT 'core',
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT features_pkey PRIMARY KEY (key)
);

COMMENT ON TABLE public.features IS
  'Feature catalog (EPIC-5). System reference data; adding a module = seeding a key here.';

CREATE TRIGGER features_touch_updated_at
  BEFORE UPDATE ON public.features
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.features FORCE  ROW LEVEL SECURITY;

CREATE POLICY features_read ON public.features
  FOR SELECT USING (true);
CREATE POLICY features_seed ON public.features
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 2. plans — subscription tiers.
-- ---------------------------------------------------------------------------
CREATE TABLE public.plans (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  code        text        NOT NULL,
  name        text        NOT NULL,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_pkey PRIMARY KEY (id),
  CONSTRAINT plans_code_key UNIQUE (code)
);

COMMENT ON TABLE public.plans IS
  'Subscription plans/tiers (EPIC-5). System reference data.';

CREATE TRIGGER plans_touch_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans FORCE  ROW LEVEL SECURITY;

CREATE POLICY plans_read ON public.plans
  FOR SELECT USING (true);
CREATE POLICY plans_seed ON public.plans
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 3. plan_features — the features each plan includes.
-- ---------------------------------------------------------------------------
CREATE TABLE public.plan_features (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL,
  feature_key text NOT NULL,
  CONSTRAINT plan_features_pkey PRIMARY KEY (id),
  CONSTRAINT plan_features_plan_feature_key UNIQUE (plan_id, feature_key),
  CONSTRAINT plan_features_plan_fk FOREIGN KEY (plan_id)
    REFERENCES public.plans (id) ON DELETE CASCADE,
  CONSTRAINT plan_features_feature_fk FOREIGN KEY (feature_key)
    REFERENCES public.features (key) ON DELETE CASCADE
);

COMMENT ON TABLE public.plan_features IS
  'Features included in a plan (EPIC-5). System reference data.';

CREATE INDEX plan_features_feature_idx ON public.plan_features (feature_key);

ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_features FORCE  ROW LEVEL SECURITY;

CREATE POLICY plan_features_read ON public.plan_features
  FOR SELECT USING (true);
CREATE POLICY plan_features_seed ON public.plan_features
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 4. permissions — the permission-key catalog.
-- ---------------------------------------------------------------------------
CREATE TABLE public.permissions (
  key         text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_pkey PRIMARY KEY (key)
);

COMMENT ON TABLE public.permissions IS
  'Permission catalog (EPIC-5). System reference data (e.g. orders.read).';

CREATE TRIGGER permissions_touch_updated_at
  BEFORE UPDATE ON public.permissions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE  ROW LEVEL SECURITY;

CREATE POLICY permissions_read ON public.permissions
  FOR SELECT USING (true);
CREATE POLICY permissions_seed ON public.permissions
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 5. feature_permissions — feature → permission edges. A permission with a row
--    here is effective only when its feature is enabled; a permission with none
--    is feature-independent (the core access.* permissions).
-- ---------------------------------------------------------------------------
CREATE TABLE public.feature_permissions (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  feature_key    text NOT NULL,
  permission_key text NOT NULL,
  CONSTRAINT feature_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT feature_permissions_feature_permission_key UNIQUE (feature_key, permission_key),
  CONSTRAINT feature_permissions_feature_fk FOREIGN KEY (feature_key)
    REFERENCES public.features (key) ON DELETE CASCADE,
  CONSTRAINT feature_permissions_permission_fk FOREIGN KEY (permission_key)
    REFERENCES public.permissions (key) ON DELETE CASCADE
);

COMMENT ON TABLE public.feature_permissions IS
  'Feature → permission edges (EPIC-5). A permission is gated by its feature. System reference data.';

CREATE INDEX feature_permissions_permission_idx ON public.feature_permissions (permission_key);

ALTER TABLE public.feature_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_permissions FORCE  ROW LEVEL SECURITY;

CREATE POLICY feature_permissions_read ON public.feature_permissions
  FOR SELECT USING (true);
CREATE POLICY feature_permissions_seed ON public.feature_permissions
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 6. permission_templates — the six role presets.
-- ---------------------------------------------------------------------------
CREATE TABLE public.permission_templates (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  key         text        NOT NULL,
  name        text        NOT NULL,
  description text,
  is_system   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permission_templates_pkey PRIMARY KEY (id),
  CONSTRAINT permission_templates_key_key UNIQUE (key)
);

COMMENT ON TABLE public.permission_templates IS
  'Role presets (EPIC-5): Owner, Store Manager, Call Center, Warehouse, Finance, Marketing.';

CREATE TRIGGER permission_templates_touch_updated_at
  BEFORE UPDATE ON public.permission_templates
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.permission_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_templates FORCE  ROW LEVEL SECURITY;

CREATE POLICY permission_templates_read ON public.permission_templates
  FOR SELECT USING (true);
CREATE POLICY permission_templates_seed ON public.permission_templates
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 7. role_permissions — template → permission edges.
-- ---------------------------------------------------------------------------
CREATE TABLE public.role_permissions (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL,
  permission_key text NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT role_permissions_template_permission_key UNIQUE (template_id, permission_key),
  CONSTRAINT role_permissions_template_fk FOREIGN KEY (template_id)
    REFERENCES public.permission_templates (id) ON DELETE CASCADE,
  CONSTRAINT role_permissions_permission_fk FOREIGN KEY (permission_key)
    REFERENCES public.permissions (key) ON DELETE CASCADE
);

COMMENT ON TABLE public.role_permissions IS
  'Permissions each template grants (EPIC-5). System reference data.';

CREATE INDEX role_permissions_permission_idx ON public.role_permissions (permission_key);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE  ROW LEVEL SECURITY;

CREATE POLICY role_permissions_read ON public.role_permissions
  FOR SELECT USING (true);
CREATE POLICY role_permissions_seed ON public.role_permissions
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- ---------------------------------------------------------------------------
-- 8. platform_admins — the platform Super-Admin grant. NOT tenant-scoped and
--    isolated from tenant roles. Seeded from SUPER_ADMIN_EMAILS. A signed-in
--    user may read only their own grant row (self policy); the seed (null
--    context) may read/write all rows.
-- ---------------------------------------------------------------------------
CREATE TABLE public.platform_admins (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admins_pkey PRIMARY KEY (id),
  CONSTRAINT platform_admins_user_key UNIQUE (user_id),
  CONSTRAINT platform_admins_user_fk FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.platform_admins IS
  'Platform Super-Admin grant (EPIC-5). Platform-level privilege, isolated from tenant roles.';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins FORCE  ROW LEVEL SECURITY;

CREATE POLICY platform_admins_self_select ON public.platform_admins
  FOR SELECT USING (user_id = app.current_user_id());
CREATE POLICY platform_admins_seed ON public.platform_admins
  FOR ALL
  USING (app.current_user_id() IS NULL)
  WITH CHECK (app.current_user_id() IS NULL);

-- Is the current principal a platform Super-Admin? STABLE, SECURITY INVOKER: it
-- runs with the caller's RLS, and the platform_admins self-SELECT policy makes
-- exactly the caller's own grant row visible — so it needs no elevated privilege
-- and cannot probe other users' grants. `search_path = ''` pins name resolution.
CREATE OR REPLACE FUNCTION app.is_platform_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = app.current_user_id()
  );
$$;

COMMENT ON FUNCTION app.is_platform_admin() IS
  'True when app.current_user_id() holds the platform Super-Admin grant.';

-- Super-Admin cross-tenant read of companies. The Super-Admin surface lists all
-- companies (to toggle features / set plans); widen the M4.4 companies SELECT
-- policy so a platform admin sees every company. Tenant-scoped writes to
-- subscriptions / feature flags stay under their strict tenant policies — the
-- admin controller binds the target company as the active tenant before writing.
DROP POLICY IF EXISTS companies_tenant_select ON public.companies;

CREATE POLICY companies_tenant_select ON public.companies
  FOR SELECT
  USING (
    id = app.current_company_id()
    OR created_by = app.current_user_id()
    OR app.is_company_member(id)
    OR app.is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- 9. subscriptions — a company's active plan. Tenant-scoped (one per company).
-- ---------------------------------------------------------------------------
CREATE TABLE public.subscriptions (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL,
  plan_id            uuid        NOT NULL,
  status             text        NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_company_key UNIQUE (company_id),
  CONSTRAINT subscriptions_status_check CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  CONSTRAINT subscriptions_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT subscriptions_plan_fk FOREIGN KEY (plan_id)
    REFERENCES public.plans (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.subscriptions IS
  'A company''s active subscription (EPIC-5). Tenant-scoped; set by a Super-Admin.';

CREATE TRIGGER subscriptions_touch_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE  ROW LEVEL SECURITY;

CREATE POLICY subscriptions_tenant ON public.subscriptions
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 10. company_feature_flags — per-company feature override. Tenant-scoped.
-- ---------------------------------------------------------------------------
CREATE TABLE public.company_feature_flags (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  feature_key text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_feature_flags_pkey PRIMARY KEY (id),
  CONSTRAINT company_feature_flags_company_feature_key UNIQUE (company_id, feature_key),
  CONSTRAINT company_feature_flags_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT company_feature_flags_feature_fk FOREIGN KEY (feature_key)
    REFERENCES public.features (key) ON DELETE CASCADE
);

COMMENT ON TABLE public.company_feature_flags IS
  'Per-company feature on/off override (EPIC-5). Tenant-scoped; toggled by a Super-Admin.';

CREATE TRIGGER company_feature_flags_touch_updated_at
  BEFORE UPDATE ON public.company_feature_flags
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.company_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_feature_flags FORCE  ROW LEVEL SECURITY;

CREATE POLICY company_feature_flags_tenant ON public.company_feature_flags
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 11. add_ons — a feature granted to a company beyond its plan. Tenant-scoped.
-- ---------------------------------------------------------------------------
CREATE TABLE public.add_ons (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  feature_key text        NOT NULL,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT add_ons_pkey PRIMARY KEY (id),
  CONSTRAINT add_ons_company_feature_key UNIQUE (company_id, feature_key),
  CONSTRAINT add_ons_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT add_ons_feature_fk FOREIGN KEY (feature_key)
    REFERENCES public.features (key) ON DELETE CASCADE
);

COMMENT ON TABLE public.add_ons IS
  'Feature granted to a company beyond its plan (EPIC-5). Tenant-scoped; additive.';

CREATE TRIGGER add_ons_touch_updated_at
  BEFORE UPDATE ON public.add_ons
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.add_ons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.add_ons FORCE  ROW LEVEL SECURITY;

CREATE POLICY add_ons_tenant ON public.add_ons
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 12. member_permissions — per-member permission override. Tenant-scoped.
-- ---------------------------------------------------------------------------
CREATE TABLE public.member_permissions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL,
  member_id      uuid        NOT NULL,
  permission_key text        NOT NULL,
  granted        boolean     NOT NULL DEFAULT true,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT member_permissions_member_permission_key UNIQUE (company_id, member_id, permission_key),
  CONSTRAINT member_permissions_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT member_permissions_member_fk FOREIGN KEY (member_id)
    REFERENCES public.company_members (id) ON DELETE CASCADE,
  CONSTRAINT member_permissions_permission_fk FOREIGN KEY (permission_key)
    REFERENCES public.permissions (key) ON DELETE CASCADE
);

COMMENT ON TABLE public.member_permissions IS
  'Per-member permission grant/revoke override on top of the member template (EPIC-5). Tenant-scoped.';

CREATE INDEX member_permissions_member_idx ON public.member_permissions (company_id, member_id);

CREATE TRIGGER member_permissions_touch_updated_at
  BEFORE UPDATE ON public.member_permissions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_permissions FORCE  ROW LEVEL SECURITY;

CREATE POLICY member_permissions_tenant ON public.member_permissions
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
