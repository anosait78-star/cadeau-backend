# EPIC-8 Products — Technical Review

**Epic:** EPIC-8 Product Catalog + Variants · **Branch:** `feat/epic-8-products`
· **Commit:** `00a3f0d` · **Reviewed:** 2026-07-31.

A dimension-by-dimension review of the delivered products module — backend
(`apps/api/src/modules/products/`, `/v1/products`), data
(`products` + `product_variants`, migration `20260803000000_products`), and the
capability-gated Products frontend screen. Companion to
[product-domain.md](product-domain.md) (the model) and
[epic-8-quality-gate.md](epic-8-quality-gate.md) (the formal §2.5 gate).

---

## 1. Product model

- **Table `products`** — a tenant-editable catalog item: `id`, `company_id`,
  `name`, `description?`, `category_id?` (→ `product_categories`, EPIC-7),
  `unit_id?` (→ `units`, EPIC-7), `is_active`, plus the standard base columns
  (`created_by`/`updated_by`/`created_at`/`updated_at`). `FORCE` RLS by
  `company_id` and the `app.touch_updated_at()` trigger, per
  [core-data.md](core-data.md) §16.2.
- **Unique per company by name** (`products_company_name_key`). Category/unit FKs
  are `ON DELETE SET NULL` so archiving a reference row never orphans a product;
  `company_id` FK is `ON DELETE CASCADE`.
- **Domain view is decoupled from the row** — `ProductView`
  ([product.entity.ts](../apps/api/src/modules/products/domain/product.entity.ts))
  renames `is_active` → `active` and stamps ISO-8601 timestamps, so the Prisma
  shape never leaks past `infrastructure`.

**Assessment: sound.** Classification is optional and additive; the model
carries no pricing/stock concerns (correctly deferred to EPIC-9/EPIC-13).

## 2. Variant model

- **Table `product_variants`** — a concrete sellable unit under a product:
  `id`, `company_id` (denormalized so RLS scopes the variant directly), `product_id`,
  `name`, `sku?`, `barcode?`, `average_cost`, `is_active`, base columns. `FORCE`
  RLS, `touch_updated_at` trigger, `product_id` FK `ON DELETE CASCADE`.
- **Unique per product by name** (`product_variants_product_name_key`).
- **`average_cost bigint DEFAULT 0`** with a `>= 0` CHECK — moving-average cost in
  integer minor units ([api-conventions](api-conventions.md) §money), **derived
  from receipts (EPIC-13), never client-set.** The DTO omits it from all write
  payloads; the repository never writes it. Read-only by construction.

**Assessment: sound.** Denormalizing `company_id` onto the variant is the right
call — it lets a single RLS policy scope variants without a join, and the parent
FK keeps the two in the same tenant.

## 3. SKU strategy

- **Optional, free-form** (`text`, ≤120 chars). Not every variant needs a code;
  multiple NULLs are allowed.
- **Unique per company when present** — enforced by a **partial** unique index
  `product_variants_company_sku_key … WHERE sku IS NOT NULL`, so codeless
  variants never collide. Uniqueness is company-wide (not per-product), which is
  correct for barcode-scanner / POS lookups.
- A P2002 violation is mapped in `mapWriteError` to a `DuplicateProductError("sku")`
  → `409 CONFLICT` with the offending field.

**Assessment: sound.** Partial unique index is the correct Postgres idiom for
"unique if present." No auto-generation — deliberate; the tenant owns its codes.

## 4. Barcode strategy

- Identical shape to SKU: optional `text` (≤120), partial unique index
  `product_variants_company_barcode_key … WHERE barcode IS NOT NULL`, P2002 →
  `DuplicateProductError("barcode")` → `409`.
- Searchable (see §5). No format validation (EAN/UPC check-digit) — acceptable
  for v1; barcodes are free-form identifiers here, not validated symbologies.

**Assessment: sound for v1.** If a future epic needs symbology validation it is
an additive DTO constraint, no schema change.

## 5. Search

- **`q`** does a case-insensitive `contains` over product `name` **and** each
  product's variants' `sku` / `barcode` (`variants: { some: { … } }`), so a
  scanned barcode or partial SKU finds its parent product
  ([products.repository.ts](../apps/api/src/modules/products/infrastructure/products.repository.ts)
  `buildWhere`).
- Combined with `categoryId` and the `active` tri-state as `AND` predicates.
- **Keyset pagination only** (api-conventions §5): sort whitelist `name` |
  `-createdAt` (default) with `id` tie-breaker; opaque cursor decoded/validated,
  a tampered cursor → `InvalidListCursorError` → `400`.

**Assessment: sound.** One caveat recorded as debt: `contains` with a leading
wildcard cannot use a btree index, so `q` is a sequential scan within the tenant.
Acceptable at catalog scale; a `pg_trgm` / tsvector index is the upgrade path if
a tenant's catalog grows large (noted in the retrospective).

## 6. Validation

- **DTO layer** (`class-validator`): `name` required 1–200; `description` ≤2000;
  `sku`/`barcode` ≤120; `categoryId`/`unitId` are `@IsUUID`. `averageCost` is not
  a DTO field, so the global whitelist pipe strips any client attempt.
- **List-query layer**
  ([list-query.ts](../apps/api/src/modules/products/domain/list-query.ts)):
  pure parse/normalize with a sort whitelist, `active` tri-state, and UUID check
  for `categoryId`; bad values → `400 VALIDATION_FAILED` with `{field, messages}`.
- **Reference integrity**: `assertProductRefs` confirms `categoryId`/`unitId`
  resolve **under the tenant's RLS context** in the same transaction → a missing
  reference is `422 UNPROCESSABLE_ENTITY` (not a raw FK error).
- **PATCH semantics**: omit = unchanged, explicit `null` = clear — implemented via
  the `"field" in data` guard in `productWriteData`.

**Assessment: sound.** Validation is layered (transport DTO / query / referential)
and every failure maps to the unified error envelope. No `averageCost` write path
exists at any layer.

## 7. Events

- Every write emits through the **EPIC-6 in-process event bus**
  ([events.md](events.md)) **after** the durable `audit_log` write — audit is the
  source of truth, the event is additive:
  - `product.created` / `product.archived` — `{ productId }`.
  - `product.updated` — `{ productId }`; also emitted when a variant is added or
    updated, attributing the change to the parent product.
- Types are declared in the closed catalog
  ([event-catalog.ts](../apps/api/src/shared/events/event-catalog.ts)); the
  compiler rejects a typo or a mis-shaped payload. Payloads are id-only
  (secret-free), consistent with the bus contract.

**Assessment: sound.** The variant-change → `product.updated` attribution is a
sensible aggregate boundary: downstream consumers (inventory EPIC-9) track the
product, not the variant lifecycle, so one event type suffices.

## 8. API

- **8 routes under `/v1/products`**, every one gated by
  **Subscription ∧ Feature (`products`) ∧ Permission** (EPIC-5 `AccessGuard`):
  reads need `products.read`, writes `products.manage`. Tenant comes from the
  token, never the payload (ADR-003); path ids validated as UUIDs.
- Correct HTTP semantics: `POST` → `201` + `Location`; `PATCH` → `200`; `DELETE`
  → `204` (soft archive); collections enveloped, single resources raw
  (api-conventions §3). OpenAPI annotated with stable `operationId`s.
- Permission naming reconciled: the draft's `products.write` is delivered as
  `products.manage`, matching the project-wide `read`/`manage` convention — no
  EPIC-5 catalog change needed ([api/products.md](api/products.md)).

**Assessment: sound.** Contract matches the delivered controller exactly.

## 9. Frontend

- Capability-gated **Products screen** in the Dual Shell
  ([products-page.tsx](../apps/web/src/pages/products/products-page.tsx)): search,
  responsive card list, create/edit/archive, inline variant management, and
  category/unit selects sourced from the EPIC-7 master data. `ar`/`en` (ar-first),
  nav entry + route registered.
- Gated by the same capabilities as the API, so the UI never offers an action the
  server would reject. 90 web tests pass (27 files).

**Assessment: sound.** Follows the Dual UX rules (card alternative for every
table, no hover/right-click for core actions). Coverage on the page is 82.9% —
the main untested branches are error/edge paths, acceptable and noted as debt.

## 10. Documentation

- [api/products.md](api/products.md) — full contract, marked ✅ Delivered, with
  the deferred `hasStock` / `Idempotency-Key` items honestly recorded.
- [events.md](events.md) — the three `product.*` events listed in the catalog.
- [execution-plan.md](execution-plan.md) — EPIC-8 marked delivered, test baseline
  552 recorded.
- This review, [product-domain.md](product-domain.md), and
  [epic-8-retrospective.md](epic-8-retrospective.md) added for closure.

**Assessment: sound.** Docs match the code; deferrals are explicit, not silent.

---

## Findings & fixes during review

- **Type-check gate was red locally.** `products.controller.test.ts` typed its
  service mock as `Record<string, …>`, which under the project's strict
  `noPropertyAccessFromIndexSignature` + `noUncheckedIndexedAccess` produced
  TS4111/TS18048 across 13 accesses. Fixed by typing the mock as a mapped type
  over `ProductsService` (`{ [K in keyof ProductsService]: … }`), giving real,
  non-optional properties. Type-check is now green (8/8). No production code was
  affected. See [epic-8-quality-gate.md](epic-8-quality-gate.md) §Testing.

## Verdict

**All ten dimensions pass.** One gate defect (type-check) found and fixed during
review; no correctness, security, or contract issues in production code. EPIC-8 is
ready for the formal quality gate.
