-- Vendor Accounts — Phase 1 (self-service warehouse join codes). A rotatable,
-- revocable, unguessable code per warehouse that a self-registering "vendor"
-- uses to join the company scoped to exactly that warehouse.
--
-- Two additive, backward-compatible changes:
--
--   1. company_members.warehouse_id (nullable) — the single warehouse a member
--      is scoped to. NULL for every existing row and every non-vendor member
--      created going forward: an unscoped member keeps seeing the whole
--      company exactly as before. Set only by accepting a warehouse join code
--      (role = 'vendor'). RESTRICT on delete: a warehouse with an active
--      vendor member cannot be hard-deleted out from under them (the existing
--      archive/soft-delete path is unaffected).
--
--   2. warehouse_join_codes — one row per warehouse (unique warehouse_id): the
--      company-managed "current slot" that can be created/rotated/revoked.
--      Distinct from `invitations` on purpose: not email-scoped, reusable by
--      anyone holding the code, no expiry (only is_active). `code_hash`
--      follows the same show-once convention as `invitations.code_hash` — the
--      plaintext is returned to the caller once, at creation/rotation time,
--      and never stored or re-derivable.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. company_members.warehouse_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_members
  ADD COLUMN warehouse_id uuid;

ALTER TABLE public.company_members
  ADD CONSTRAINT company_members_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.company_members.warehouse_id IS
  'The single warehouse this member is scoped to (Vendor Accounts, Phase 1). '
  'NULL for every member created before this column existed and for every '
  'non-vendor member going forward — an unscoped member sees the whole '
  'company exactly as before. Set only when the membership was created by '
  'accepting a warehouse_join_codes row (role = ''vendor''); the scope is '
  'always company -> member -> warehouse, never a bare warehouse id.';

CREATE INDEX company_members_warehouse_idx
  ON public.company_members (warehouse_id) WHERE warehouse_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. warehouse_join_codes — one active/rotatable slot per warehouse.
-- ---------------------------------------------------------------------------
CREATE TABLE public.warehouse_join_codes (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL,
  warehouse_id uuid        NOT NULL,
  code_hash    text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_join_codes_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_join_codes_warehouse_key UNIQUE (warehouse_id),
  CONSTRAINT warehouse_join_codes_code_hash_key UNIQUE (code_hash),
  CONSTRAINT warehouse_join_codes_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT warehouse_join_codes_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.warehouse_join_codes IS
  'Self-service, warehouse-scoped join code (Vendor Accounts, Phase 1). One '
  'row per warehouse — the company''s current create/rotate/revoke slot, not '
  'a history of past codes. Not email-scoped and not single-use, unlike '
  'invitations; only is_active gates it (no expiry).';

CREATE INDEX warehouse_join_codes_company_idx
  ON public.warehouse_join_codes (company_id);

CREATE TRIGGER warehouse_join_codes_touch_updated_at
  BEFORE UPDATE ON public.warehouse_join_codes
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.warehouse_join_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_join_codes FORCE  ROW LEVEL SECURITY;

-- Standard tenant policy: company-side create/view/rotate/revoke.
CREATE POLICY warehouse_join_codes_tenant
  ON public.warehouse_join_codes
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- Bootstrap SELECT-only policy, mirroring `invitations_code_lookup`
-- (20260731000000_auth_totp_and_tenant_bootstrap): an authenticated user with
-- NO active tenant yet may look up an active code by its hash, to resolve it
-- during self-registration/join. Never exposes inactive/revoked rows.
CREATE POLICY warehouse_join_codes_lookup
  ON public.warehouse_join_codes
  FOR SELECT
  USING (
    is_active = true
    AND app.current_user_id() IS NOT NULL
  );
