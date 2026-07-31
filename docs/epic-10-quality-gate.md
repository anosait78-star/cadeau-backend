# EPIC-10 Quality Gate (§2.5) — Customers

**Epic:** EPIC-10 Customers · **Branch:** `feat/epic-10-customers` · **Commits:**
`1a5b440` (M10.1) · `6393630` (M10.2) · `1f4a920` (M10.3) · `dfbdae3` (M10.4) ·
this doc (M10.5) · **Gate run:** 2026-07-31.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing ·
Performance · API/Contract · Documentation · Extensibility · AI-out guarantee —
plus **owner approval**. No new epic starts until every dimension passes and the
owner signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                       |
| ----------------- | :-----: | -------------------------------------------------------------------------- |
| Security          | ✅ PASS | PII split into ciphertext + blind index; no unaudited path to bulk PII     |
| Architecture      | ✅ PASS | Clean 4-layer module; deps inward; `arch:check` 0 violations               |
| Code              | ✅ PASS | Strict TS, no `any`; invariants in the DB and in the type system           |
| Testing           | ✅ PASS | 795 unit/integration green from a cold cache; replay-race branches covered |
| Performance       | ✅ PASS | Keyset list on a covering index; web bundle 153.3 KB / 200 KB gzip         |
| API / Contract    | ✅ PASS | [api/customers.md](api/customers.md) matches the delivered 9 routes        |
| Documentation     | ✅ PASS | contract, review, domain, retrospective, privacy model, this gate          |
| Extensibility     | ✅ PASS | Attached through existing seams; **no access-catalog change** (D2)         |
| AI-out (ADR-0004) | ✅ PASS | No AI import; `no-ai-imports` guard still green                            |

**Local gates (this run, cold cache):** `format:check` ✅ · `lint` ✅ ·
`type-check` ✅ (8/8) · `test` ✅ **795 passed** (config 40 · web 111 · crypto 35 ·
database 71 · api 538) · `build` ✅ (5/5) · `arch:check` ✅ (434 modules, 1048 deps,
0 violations) · `check-stable-only` ✅ · `audit --audit-level high` ✅ (0 high;
1 moderate, under the gate threshold) · `perf:bundle` ✅ (`@cadeau/web`
153.3 KB / 200 KB gzip).

**CI-only gates:** `database` (migrations + RLS on real Postgres), `e2e`
(Playwright desktop+mobile + axe), `performance` (Lighthouse), `api-load` (k6),
`sast`, secret-scan — run on push/PR to `main`. This epic adds a migration and a UI
screen, so `database`/`e2e`/`performance` produce fresh evidence there; they cannot
run on this workstation (no Docker/browser/k6).

> **Gate integrity note.** Every local gate was re-run **from a cold cache** for this
> gate, the practice adopted after the EPIC-8 gate found a cached type-check "pass"
> masking a real strict-mode error. This run was green on the first pass; no
> production or test code changed during the gate. The EPIC-9 tooling observation
> still applies: turbo needs a resolvable `pnpm` binary on `PATH`, and
> `prisma generate` races under parallel tasks (`--concurrency=1` is green; CI runs
> the packages independently).

---

## 1. Security review

- **The phone is never stored readable.** `phone_encrypted` (AES-256-GCM) is the
  source of truth; `phone_hash` (HMAC-SHA256 under a **separate** key, validated at
  startup to differ from `ENCRYPTION_KEY`) carries uniqueness and exact lookup.
  There is no plaintext phone column to leak.
- **Uniqueness is a database index**, `UNIQUE (company_id, phone_hash)` — not an
  application check a race could slip past. The `409` names the `phone` **field**,
  never the colliding row's id, so it cannot confirm a record the caller may have no
  right to read.
- **Two-layer tenant isolation.** Both tables carry `FORCE` RLS with
  `USING/WITH CHECK (company_id = app.current_company_id())`, and the repository
  binds `setTenantContext` and filters on `companyId` inside every transaction. The
  tenant comes from the token, never the payload (ADR-003); a principal with no
  active company gets `403`.
- **No unaudited path to bulk PII.** Export is gated by `customers.manage` (D2),
  writes the `audit_log` row and emits `customer.exported` **before** returning
  rows, is capped at 5000 rows, and takes its filters in the request **body** so a
  phone never reaches a URL or an access log.
- **PII stays out of the observable surfaces.** Audit `changes` and event payloads
  carry ids and field **names** only; cursors carry sort keys only
  ([privacy-model.md](privacy-model.md) §6, verified item by item in
  [customers-review.md](customers-review.md) §7).
- **Decrypt late, for few rows.** Lists return masked phones; the full value is
  decrypted on the single-customer read only.
- `audit --audit-level high` clean (1 moderate, under threshold); `stable-only`
  clean.

**Result: PASS.**

## 2. Architecture review

- **Clean four-layer module** (`domain`/`application`/`infrastructure`/
  `presentation`) with dependencies pointing inward. Prisma, encryption and hashing
  are confined to `infrastructure` — **nothing above the repository ever sees a hash
  or a ciphertext**; ports (`CustomersRepositoryPort`, `CustomersAuditPort`) invert
  the boundary.
- No cross-feature imports; master-data, access and the event bus are consumed
  through their shared surfaces. `arch:check` **green: 434 modules, 1048 deps, 0
  violations.**

**Result: PASS.**

## 3. Code review

- TypeScript strict, `readonly` views, no `any`, no `process.env` in the module.
- **The invariants are structural**, not procedural: phone uniqueness and "one
  default address per customer" are database indexes; the mask/full split is a type
  distinction (`CustomerListView` has no full-phone field); the derived KPIs are
  absent from every DTO, command and repository input type, so no layer can write
  them.
- Normalization to E.164 is **one function** serving both writes and lookups —
  the property the unique index depends on (invariant I4).
- Domain errors map to the unified envelope with field-specific details: duplicate
  → `409` (`field: phone`), un-normalizable phone / unknown governorate → `422`,
  tampered cursor → `400`, cross-tenant read → `404`.
- **No defects found** during the review (see
  [customers-review.md](customers-review.md) §Findings). One scope note is recorded
  there rather than hidden: the export read path was added in M10.3.

**Result: PASS.**

## 4. Testing

- **795 tests pass** — phone normalization against messy input, list-query parsing
  (including the phone-vs-text routing of `q`), service (tenant enforcement,
  normalization-before-repository, audit + emit, replay writes nothing, export
  audits before returning, error mapping), repository (RLS transactions, the PII
  round-trip, blind-index search, **both idempotency replay branches**, keyset
  cursors, default-address demotion, export cap), audit adapter, the controller
  (HTTP semantics, `200` on replay, no KPI write path), DTOs, and the Customers page
  (11 web tests, including "the full phone never appears until the detail read").
- api tests grew 435 → 538 in this epic; config 37 → 40 and crypto 25 → 35 for the
  hash key and `blindIndex()`; web 100 → 111; the tree grew 668 → 795.
- The type-check gate is green from a cold cache (8/8).

**Result: PASS.**

## 5. Performance

- **Keyset pagination only**, over `(company_id, created_at DESC, id DESC)` and the
  whitelisted `name` sort key. No OFFSET scans.
- An exact-phone lookup is **one indexed equality** on `phone_hash` — the property
  the blind index was chosen for.
- **Known limit, stated rather than hidden:** a masked list still decrypts every row
  to mask it. Masking bounds the response, not the work. Acceptable at page size 25;
  revisit if list sizes grow.
- Export is bounded at 5000 rows per call.
- Web bundle **153.3 KB / 200 KB** gzip after adding the Customers screen
  (150.2 → 153.3 KB, +3.1 KB).

**Result: PASS.**

## 6. API / contract review

- [api/customers.md](api/customers.md) documents all 9 routes (6 customer + 3
  nested address), permissions, list params, phone handling, idempotency and its
  status codes, export semantics, errors, events and audit. It matches the delivered
  controller exactly (routes, status codes, `operationId`s).
- No breaking change to any existing contract.
- **No access-catalog change** — `customers` and `customers.read`/`customers.manage`
  were already in the EPIC-5 catalog, and D2 deliberately declined to add a third
  action.
- Deferrals are in the contract, not implicit: merge, order history, `hasOrders`,
  the KPI sorts, and partial-phone search.

**Result: PASS.**

## 7. Documentation review

- [api/customers.md](api/customers.md) (✅ Delivered), [events.md](events.md)
  (`customer.created`/`.updated`/`.exported` live; `.merged` reserved),
  [privacy-model.md](privacy-model.md) (marked implemented and verified),
  [execution-plan.md](execution-plan.md) (EPIC-10 delivered, 795 baseline),
  [project-metrics.md](project-metrics.md) and [domain-map.md](domain-map.md)
  (refreshed at this gate), plus the three closure docs added this gate:
  [customers-review.md](customers-review.md),
  [customers-domain.md](customers-domain.md),
  [epic-10-retrospective.md](epic-10-retrospective.md).

**Result: PASS.**

## 8. Extensibility review (ADR-0004)

- EPIC-10 attached a full domain module through the existing seams — access
  catalog, event bus, audit log, master data — with **no core change** and no new
  cross-cutting concern. The third consecutive epic to do so.
- Downstream hooks are **declared, not stubbed**: the KPI columns exist with no
  write path (EPIC-11 fills them), `customer.merged` is reserved in the closed event
  catalog (EPIC-11 emits it), and the delivery address is ready for EPIC-12 without
  a line of shipping code in this module.

**Result: PASS.**

## 9. AI-out guarantee (ADR-0004)

- No AI SDK / hosted-inference import anywhere in the customers module; the
  `no-ai-imports` architecture rule remains green across the tree. The `ai` feature
  stays inactive.

**Result: PASS.**

---

## Owner approval

All nine technical dimensions **PASS**; all local gates green from a cold cache
with no defects found; CI-only gates wired for push/PR.

- [x] **All EPIC-10 quality-gate dimensions pass** — verified 2026-07-31.
- [x] **Owner approval to close EPIC-10 and begin EPIC-11 (Orders).**
      Signed off 2026-07-31.

> **EPIC-10 status: ✅ CLOSED.** All nine dimensions pass, all local gates green
> from a cold cache, owner sign-off recorded above. The epic adds a migration and a
> UI screen, so the CI-only `database`/`e2e`/`performance` jobs complete the
> evidence set on push.
>
> **EPIC-11 (Orders) is open.**
>
> **What EPIC-11 (Orders) inherits from this epic:** the KPI computation
> (`ordersCount`, `totalSpent`, `lastOrderAt`), customer merge — written once
> against the complete set of customer-owned tables (D3) — the customer
> order-history endpoint, and the `hasOrders` filter with the two KPI sorts. See
> [customers-domain.md](customers-domain.md) §8.
