-- EPIC-4 · M4.4 — 2FA (TOTP) + tenant bootstrap (company create/switch, invites).
--
-- Builds on M4.2's Auth + tenancy tables. Two things:
--
--   1. profiles gains TOTP 2FA state: an encrypted secret (@cadeau/crypto, never
--      plaintext) and an "enabled at" timestamp. Enrolment stores the secret;
--      verification of a valid code flips it on.
--
--   2. RLS is widened for the M4.2 tables so the M4.4 *bootstrap* flows work
--      under the two-layer isolation model — company creation, listing "my
--      companies" across tenants, tenant switching, and invite acceptance — all
--      of which act before (or across) a single active tenant:
--
--        * companies      — a signed-in user may CREATE a company they own, and
--                           SELECT any company they created or are a member of
--                           (so /v1/me and the company switcher can list them).
--        * company_members— a user may read + create their OWN membership rows
--                           regardless of the active tenant (owner row on create,
--                           the joining row on accept, and the /v1/me listing),
--                           in addition to tenant-scoped member management.
--        * invitations    — an authenticated user with NO active tenant may look
--                           up a *live* pending invite (by its secret code hash)
--                           to resolve its company before switching into it.
--
-- This mirrors the null-context bootstrap already sanctioned for profiles/sessions
-- in M4.2: the RLS floor stays independent of the app layer, but the narrow
-- pre-/cross-tenant windows the identity flows genuinely need are permitted. No
-- SECURITY DEFINER and no privileged role are required — every widening is
-- expressed in terms of app.current_user_id() / app.current_company_id(), which
-- the BFF binds per transaction.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. profiles — TOTP 2FA columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN totp_secret_encrypted text,
  ADD COLUMN totp_enabled_at       timestamptz;

COMMENT ON COLUMN public.profiles.totp_secret_encrypted IS
  'AES-256-GCM ciphertext of the base32 TOTP secret (@cadeau/crypto). Never plaintext.';
COMMENT ON COLUMN public.profiles.totp_enabled_at IS
  'When 2FA was confirmed (a valid code verified). NULL ⇒ enrolled-but-unconfirmed or off.';

-- ---------------------------------------------------------------------------
-- 2. Membership helper — is the current principal a member of a company?
--
-- STABLE, SECURITY INVOKER (default): it runs with the caller's RLS in force.
-- That is exactly what we want — it only ever inspects the caller's OWN rows
-- (user_id = app.current_user_id()), which the company_members self-policy below
-- makes visible, so it needs no elevated privilege and cannot leak other users'
-- memberships. company_members' policy does not reference companies, so there is
-- no policy recursion. `search_path = ''` pins name resolution.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.is_company_member(target uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.company_id = target
      AND m.user_id = app.current_user_id()
  );
$$;

COMMENT ON FUNCTION app.is_company_member(uuid) IS
  'True when app.current_user_id() has a membership row in the given company.';

-- ---------------------------------------------------------------------------
-- 3. companies — allow creation and cross-tenant "my companies" reads.
--
-- SELECT: the active tenant (unchanged), plus companies the caller created or is
-- a member of (needed for INSERT ... RETURNING on create, /v1/me, and switching).
-- INSERT: a signed-in user may create a company they stamp as their own; the
-- companion owner-membership row is created in the same transaction. UPDATE stays
-- strictly the active tenant (management is refined by permissions in EPIC-5).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS companies_tenant_select ON public.companies;

CREATE POLICY companies_tenant_select ON public.companies
  FOR SELECT
  USING (
    id = app.current_company_id()
    OR created_by = app.current_user_id()
    OR app.is_company_member(id)
  );

CREATE POLICY companies_create ON public.companies
  FOR INSERT
  WITH CHECK (app.current_user_id() IS NOT NULL AND created_by = app.current_user_id());

-- ---------------------------------------------------------------------------
-- 4. company_members — self-owned rows across tenants + tenant-scoped management.
--
-- A user must be able to READ their OWN membership rows outside the active-tenant
-- window — the /v1/me listing and the company switcher span tenants. Writes,
-- though, stay strictly tenant-scoped: every membership INSERT the app performs
-- (the owner row on company creation, the joining row on invite acceptance) runs
-- with the target company bound as the active tenant, so `company_id =
-- app.current_company_id()` always holds. Keeping WITH CHECK tenant-only means a
-- principal can never self-insert into an arbitrary company. Replaces the M4.2
-- strict-tenant policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS company_members_tenant ON public.company_members;

CREATE POLICY company_members_access ON public.company_members
  USING (
    company_id = app.current_company_id()
    OR user_id = app.current_user_id()
  )
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 5. invitations — pre-tenant code lookup for acceptance.
--
-- Creating, listing, and revoking invites stay tenant-scoped (invitations_tenant,
-- from M4.2). Acceptance runs before the invitee has the invite's company as
-- their active tenant, so it must first resolve the company from the secret code.
-- This adds a SELECT-only bootstrap: an authenticated user with NO active tenant
-- may read *live* pending invites (the app always filters by the code hash, so in
-- practice only the row whose secret code the caller holds is returned). Once the
-- company is known the caller switches into it and the strict tenant policy takes
-- over for the membership insert + status update.
-- ---------------------------------------------------------------------------
CREATE POLICY invitations_code_lookup ON public.invitations
  FOR SELECT
  USING (
    app.current_company_id() IS NULL
    AND app.current_user_id() IS NOT NULL
    AND status = 'pending'
    AND revoked_at IS NULL
    AND expires_at > now()
  );
