-- EPIC-14 — Analytics (M14.1).
--
-- Analytics is read-only across every existing domain table (orders,
-- order_items, product_variants, inventory_stock, expenses) and adds NO new
-- tables (docs/epic-14-design.md, D3) — every axis is computed live from
-- columns EPIC-8 through EPIC-13 already wrote.
--
-- Four of the five axes are already covered by an existing keyset index
-- (`orders_created_keyset_idx`, `order_items_keyset_idx`,
-- `inventory_stock_updated_keyset_idx`, `expenses_keyset_idx`). The staff
-- axis groups `orders` by `assignee_id` within a `company_id` + date range,
-- and the existing `orders_assignee_idx` is a bare single-column index (no
-- company/date compound) — this migration adds the one supporting index the
-- staff axis needs so its grouped range scan doesn't fall back to a full
-- company scan.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

CREATE INDEX "orders_assignee_analytics_idx" ON "public"."orders" ("company_id", "assignee_id", "created_at");
