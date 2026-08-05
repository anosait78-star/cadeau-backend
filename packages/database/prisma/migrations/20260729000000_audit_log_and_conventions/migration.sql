-- EPIC-3 — Core Data + Security Layer (foundation).
--
-- Adds the reusable security/consistency primitives every tenant table will use,
-- and the first foundation table (audit_log) that proves them end to end. No
-- tenant tables (companies/members/profiles — EPIC-4) or domain tables
-- (EPIC-7+) are created here; those are owned by their epics.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- Reusable BEFORE UPDATE trigger: refresh updated_at on every row change. Every
-- tenant table created later attaches this (its epic adds the CREATE TRIGGER),
-- so updated_at is authoritative at the database, never trusted from the client.
-- `search_path = ''` hardens name resolution to pg_catalog built-ins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.touch_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app.touch_updated_at() IS
  'BEFORE UPDATE trigger fn: refresh the row''s updated_at. Attach to every tenant table.';

-- ---------------------------------------------------------------------------
-- audit_log — append-only audit trail (foundation table, in public).
--
-- Tenant-scoped by company_id; the id default uses pgcrypto's gen_random_uuid()
-- (installed in M1.4). actor_id is nullable until Auth (EPIC-4) introduces
-- members. There is no updated_at: audit rows are immutable.
-- ---------------------------------------------------------------------------
CREATE TABLE public.audit_log (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  actor_id    uuid,
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   uuid,
  changes     jsonb,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.audit_log IS
  'Append-only, tenant-isolated audit trail (EPIC-3). RLS-forced; never updated or deleted.';

-- Keyset pagination index: default sort is (created_at DESC, id DESC) per tenant.
CREATE INDEX audit_log_keyset_idx ON public.audit_log (company_id, created_at DESC, id DESC);
-- Look up a specific entity's history within a tenant.
CREATE INDEX audit_log_entity_idx ON public.audit_log (company_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security — the second, independent isolation layer (Roadmap §1).
--
-- FORCE makes RLS apply even to the table owner (the role the BFF connects as),
-- so isolation cannot be bypassed by owning the table. Policies reference
-- app.current_company_id() (M1.4), which reads the per-transaction app.company_id
-- GUC set by withTenantTransaction.
--
-- Only SELECT and INSERT are permitted, both scoped to the active tenant. There
-- is deliberately NO UPDATE or DELETE policy: with RLS enabled and no permissive
-- policy for a command, that command is denied — enforcing append-only at the
-- database, for everyone.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_select ON public.audit_log
  FOR SELECT
  USING (company_id = app.current_company_id());

CREATE POLICY audit_log_tenant_insert ON public.audit_log
  FOR INSERT
  WITH CHECK (company_id = app.current_company_id());
