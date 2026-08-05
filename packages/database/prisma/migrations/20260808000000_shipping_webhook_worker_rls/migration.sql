-- EPIC-12 — Shipping (M12.4).
--
-- Widens shipping_webhook_events' RLS so the retry worker (docs/epic-12-design.md
-- §4 D2) can claim due events across every tenant in one statement, while
-- keeping the write path that matters (ingestion) strictly tenant-scoped.
--
-- The M12.1 migration gave this table a single combined policy
-- (`shipping_webhook_events_tenant`, USING/WITH CHECK both
-- `company_id = app.current_company_id()`), on the assumption that every
-- access is tenant-bound. That held for ingestion (the company is resolved
-- from the signed `/v1/shipping/webhooks/{carrier}/{companyId}` path before
-- insert) but not for the retry worker: it is a platform-level job that polls
-- for ANY company's due events, so it legitimately runs with no tenant bound
-- (`app.current_company_id() IS NULL`) — exactly the situation
-- `withTransaction` (packages/database/src/transaction.ts) is reserved for.
--
-- Split into three policies, mirroring the EPIC-4 M4.4 precedent
-- (`companies_tenant_select`/`companies_create` were widened the same way for
-- a different pre-tenant flow, see 20260731000000_auth_totp_and_tenant_bootstrap):
--
--   * INSERT stays strict — the webhook route always knows its company from
--     the signed path, so there is no reason to widen the write that matters.
--   * SELECT/UPDATE are widened to also permit a null tenant context — used
--     ONLY by the worker's claim step (`SELECT … FOR UPDATE SKIP LOCKED` +
--     `UPDATE … RETURNING`, both cross-tenant by necessity). Every other access
--     (marking a specific event processed/failed, ingestion) runs with the
--     event's own company bound as the active tenant, same as any other write.
--   * No DELETE policy — rows are never deleted (append/mutate only).
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

DROP POLICY IF EXISTS shipping_webhook_events_tenant ON public.shipping_webhook_events;

CREATE POLICY shipping_webhook_events_insert ON public.shipping_webhook_events
  FOR INSERT
  WITH CHECK (company_id = app.current_company_id());

-- Widened for the platform-level retry worker only (see header). A per-request
-- tenant transaction still sees exactly its own company's rows, unchanged.
CREATE POLICY shipping_webhook_events_select ON public.shipping_webhook_events
  FOR SELECT
  USING (company_id = app.current_company_id() OR app.current_company_id() IS NULL);

CREATE POLICY shipping_webhook_events_update ON public.shipping_webhook_events
  FOR UPDATE
  USING (company_id = app.current_company_id() OR app.current_company_id() IS NULL)
  WITH CHECK (company_id = app.current_company_id() OR app.current_company_id() IS NULL);
