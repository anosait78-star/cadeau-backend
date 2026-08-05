-- M1.4 — Database infrastructure (foundation only; no domain tables).
--
-- This is the first migration. It establishes the shared primitives every
-- later epic builds on: required extensions and the multi-tenant Row-Level
-- Security (RLS) context. It creates NO domain tables and seeds NO data.
--
-- Applied in every environment with `prisma migrate deploy` (forward-only in
-- staging/production). Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- Extensions (idempotent). Kept to the minimum the platform requires:
--   * pgcrypto  — gen_random_uuid() for UUID primary keys (used from EPIC-3).
--   * citext    — case-insensitive text for emails and other identifiers.
-- Further extensions are added by the epic that first needs them.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Dedicated `app` schema for platform-level helpers, kept out of `public`
-- so it never collides with domain objects.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS
  'Cadeau platform helpers (RLS context, etc.). Not for domain tables.';

-- ---------------------------------------------------------------------------
-- Multi-tenant RLS context.
--
-- The BFF sets the active tenant for each transaction with:
--     SELECT set_config('app.company_id', $companyId, true)   -- true = LOCAL
--
-- `app.current_company_id()` reads that per-transaction GUC and is the single
-- primitive every future RLS policy references, e.g.:
--     CREATE POLICY tenant_isolation ON <table>
--       USING (company_id = app.current_company_id());
--
-- It returns NULL when the GUC is unset (missing_ok = true) or empty, so a
-- query issued without a tenant context matches no tenant-scoped rows rather
-- than erroring — a safe default. `search_path = ''` pins name resolution to
-- pg_catalog built-ins (hardening against search_path manipulation).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_company_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.company_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app.current_company_id() IS
  'Current tenant id from the app.company_id transaction GUC; NULL when unset.';
