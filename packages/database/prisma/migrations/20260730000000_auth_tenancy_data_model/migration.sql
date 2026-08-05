-- EPIC-4 · M4.2 — Auth + Tenancy data model.
--
-- Adds the first real tenant/user tables on top of the EPIC-3 foundation
-- (extensions, `app.current_company_id()`, `app.touch_updated_at()`, the
-- base-column + RLS conventions from docs/core-data.md §16.2):
--
--   * profiles          — user accounts (email citext-unique, password hash,
--                         PII phone encrypted at the app layer via @cadeau/crypto).
--   * companies         — tenants (the tenant root; company_id == id).
--   * company_members   — a user's membership + role in a company.
--   * sessions          — refresh-token families for rotation + reuse detection.
--   * invitations       — revocable, expiring invites to join a company.
--
-- Isolation follows the two-layer model (Roadmap §1): the app layer scopes every
-- query, and RLS enforces the same isolation again, independently. Tenant-scoped
-- tables (companies/company_members/invitations) are scoped by
-- `app.current_company_id()`; user-owned tables (profiles/sessions) by the new
-- `app.current_user_id()`. RLS is FORCEd so it binds even the table owner (the
-- role the BFF connects as).
--
-- Bootstrap note: a few auth flows act *before* a principal is known — register
-- (insert a profile), login (read a profile by email), and refresh (read a
-- session by token hash). The user-owned policies below therefore permit the row
-- when there is NO user context bound (`app.current_user_id() IS NULL`), which is
-- exactly the pre-authentication window; once a principal IS bound (every
-- authenticated route, via withUserTransaction) the policy is strictly
-- self-scoped. Tenant tables (companies/company_members/invitations) stay strict;
-- their own pre-tenant flows (company creation, invite acceptance) are owned by
-- M4.4. Never issue a query touching profiles/sessions on an authenticated route
-- without binding the principal, or the null-context path would widen its scope.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- User RLS context — the user-scoped twin of app.current_company_id() (M1.4).
--
-- The BFF sets the authenticated principal for each transaction with:
--     SELECT set_config('app.user_id', $userId, true)   -- true = LOCAL
--
-- Returns NULL when the GUC is unset or empty (a query issued without a user
-- context matches no user-owned rows rather than erroring). `search_path = ''`
-- pins name resolution to pg_catalog built-ins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_user_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app.current_user_id() IS
  'Current principal id from the app.user_id transaction GUC; NULL when unset.';

-- ---------------------------------------------------------------------------
-- profiles — user accounts. Not tenant-scoped: a user exists independently of
-- companies and may belong to several. `email` is citext so uniqueness and
-- lookups are case-insensitive. `password_hash` is a self-built hash
-- (@cadeau/crypto); `phone_encrypted` holds an AES-256-GCM token produced by
-- @cadeau/crypto — never plaintext PII. No company member stamps (created_by/
-- updated_by) because a profile is not owned by a tenant member.
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  email           citext      NOT NULL,
  password_hash   text        NOT NULL,
  full_name       text,
  phone_encrypted text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_email_key UNIQUE (email)
);

COMMENT ON TABLE public.profiles IS
  'User accounts (EPIC-4). User-scoped by RLS; PII (phone) encrypted at the app layer.';
COMMENT ON COLUMN public.profiles.phone_encrypted IS
  'AES-256-GCM ciphertext token from @cadeau/crypto. Never store plaintext here.';

CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE  ROW LEVEL SECURITY;

CREATE POLICY profiles_self ON public.profiles
  USING (app.current_user_id() IS NULL OR id = app.current_user_id())
  WITH CHECK (app.current_user_id() IS NULL OR id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- companies — tenants. This is the tenant root, so the tenant key *is* the row
-- id: RLS scopes by `id = app.current_company_id()`. A member reads/updates only
-- their active tenant; creating a company is a pre-tenant operation handled by
-- the privileged bootstrap path (see header), so there is deliberately no INSERT
-- or DELETE policy here.
-- ---------------------------------------------------------------------------
CREATE TABLE public.companies (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       citext,
  status     text        NOT NULL DEFAULT 'active',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_pkey PRIMARY KEY (id),
  CONSTRAINT companies_slug_key UNIQUE (slug),
  CONSTRAINT companies_status_check CHECK (status IN ('active', 'suspended'))
);

COMMENT ON TABLE public.companies IS
  'Tenants (EPIC-4). Tenant root: RLS scopes by id = app.current_company_id().';

CREATE TRIGGER companies_touch_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE  ROW LEVEL SECURITY;

CREATE POLICY companies_tenant_select ON public.companies
  FOR SELECT
  USING (id = app.current_company_id());

CREATE POLICY companies_tenant_update ON public.companies
  FOR UPDATE
  USING (id = app.current_company_id())
  WITH CHECK (id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- company_members — a user's membership + role in a company. Tenant-scoped by
-- company_id. `role` is free text for now (the permission model — EPIC-5 —
-- assigns meaning); `status` is constrained. Unique (company_id, user_id): a
-- user is a member of a company at most once.
-- ---------------------------------------------------------------------------
CREATE TABLE public.company_members (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  role       text        NOT NULL DEFAULT 'member',
  status     text        NOT NULL DEFAULT 'active',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_members_pkey PRIMARY KEY (id),
  CONSTRAINT company_members_company_user_key UNIQUE (company_id, user_id),
  CONSTRAINT company_members_status_check CHECK (status IN ('invited', 'active', 'suspended')),
  CONSTRAINT company_members_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT company_members_user_fk FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.company_members IS
  'Membership + role of a user in a company (EPIC-4). Tenant-scoped by company_id.';

-- Keyset pagination per tenant, and a fast "companies this user belongs to" lookup.
CREATE INDEX company_members_keyset_idx ON public.company_members (company_id, created_at DESC, id DESC);
CREATE INDEX company_members_user_idx   ON public.company_members (user_id);

CREATE TRIGGER company_members_touch_updated_at
  BEFORE UPDATE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members FORCE  ROW LEVEL SECURITY;

CREATE POLICY company_members_tenant ON public.company_members
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- sessions — a refresh-token family per sign-in. User-owned (RLS by user_id),
-- carrying the tenant the token is scoped to. Rotation replaces the stored
-- `refresh_token_hash` and refreshes `updated_at`; reuse detection looks up a
-- presented token's hash and, on a match to an already-rotated row, revokes the
-- whole `family_id`. Only the *hash* of the refresh token is stored, never the
-- token itself.
-- ---------------------------------------------------------------------------
CREATE TABLE public.sessions (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL,
  company_id         uuid,
  family_id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  refresh_token_hash text        NOT NULL,
  user_agent         text,
  ip_address         text,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_refresh_token_hash_key UNIQUE (refresh_token_hash),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT sessions_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.sessions IS
  'Refresh-token families for rotation + reuse detection (EPIC-4). User-owned; stores token hashes only.';

-- Keyset pagination of a user's sessions, and family lookups for rotation/reuse.
CREATE INDEX sessions_user_keyset_idx ON public.sessions (user_id, created_at DESC, id DESC);
CREATE INDEX sessions_family_idx      ON public.sessions (family_id);

CREATE TRIGGER sessions_touch_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions FORCE  ROW LEVEL SECURITY;

CREATE POLICY sessions_self ON public.sessions
  USING (app.current_user_id() IS NULL OR user_id = app.current_user_id())
  WITH CHECK (app.current_user_id() IS NULL OR user_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- invitations — a revocable, expiring invite to join a company. Tenant-scoped
-- by company_id. Only the *hash* of the shareable code is stored. `status` is
-- constrained; `expires_at` bounds validity. Accepting an invite is a pre-
-- membership lookup handled by the privileged bootstrap path (see header).
-- ---------------------------------------------------------------------------
CREATE TABLE public.invitations (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  email       citext      NOT NULL,
  role        text        NOT NULL DEFAULT 'member',
  code_hash   text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending',
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at  timestamptz,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_pkey PRIMARY KEY (id),
  CONSTRAINT invitations_code_hash_key UNIQUE (code_hash),
  CONSTRAINT invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT invitations_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT invitations_accepted_by_fk FOREIGN KEY (accepted_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.invitations IS
  'Revocable, expiring invites to join a company (EPIC-4). Tenant-scoped; stores code hashes only.';

-- Keyset pagination per tenant, and pending-invite-by-email lookups.
CREATE INDEX invitations_keyset_idx ON public.invitations (company_id, created_at DESC, id DESC);
CREATE INDEX invitations_email_idx  ON public.invitations (company_id, email);

CREATE TRIGGER invitations_touch_updated_at
  BEFORE UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations FORCE  ROW LEVEL SECURITY;

CREATE POLICY invitations_tenant ON public.invitations
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
