-- Storefront Integration — widens storefront_connections' RLS so
-- StorefrontApiKeyGuard can resolve an inbound API key to its connection
-- BEFORE any tenant is known (the key itself is what determines the tenant —
-- decision D3). Mirrors the exact precedent set by
-- 20260808000000_shipping_webhook_worker_rls for the shipping retry worker's
-- cross-tenant claim, and by 20260731000000_auth_totp_and_tenant_bootstrap for
-- profiles/sessions' pre-authentication reads.
--
-- Split into three policies:
--   * INSERT/management writes stay strict (company_id = current tenant) —
--     every management route is JWT-authenticated and already tenant-bound.
--   * SELECT is widened to also permit a null tenant context
--     (`app.current_company_id() IS NULL`) — used ONLY by the guard's
--     key-hash lookup, which necessarily runs before a tenant is bound. Once
--     resolved, the guard binds that connection's own company as the active
--     tenant for the rest of the request, same as JwtAuthGuard does today.
--   * UPDATE stays strict — every write (rotate/revoke/patch/last_event_at)
--     is either a management route (already tenant-bound) or the ingestion
--     handler's own `last_event_at` touch, which runs with the resolved
--     tenant already bound.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

DROP POLICY IF EXISTS storefront_connections_tenant ON public.storefront_connections;

CREATE POLICY storefront_connections_insert ON public.storefront_connections
  FOR INSERT
  WITH CHECK (company_id = app.current_company_id());

-- Widened for the pre-tenant API-key lookup only (see header). A per-request
-- tenant transaction still sees exactly its own company's rows, unchanged.
CREATE POLICY storefront_connections_select ON public.storefront_connections
  FOR SELECT
  USING (company_id = app.current_company_id() OR app.current_company_id() IS NULL);

CREATE POLICY storefront_connections_update ON public.storefront_connections
  FOR UPDATE
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY storefront_connections_delete ON public.storefront_connections
  FOR DELETE
  USING (company_id = app.current_company_id());
