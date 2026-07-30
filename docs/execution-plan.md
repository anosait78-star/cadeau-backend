# Execution Plan — Continuation Guide

**Purpose.** A cold-start guide so any new session can pick up the next milestone
and know exactly what to build, how, and how to verify it. Read this **plus** the
canonical sources before writing code:

- `Cadeau_CRM_Implementation_Roadmap.md` (the epics, §2.4 budgets, §2.5 quality gate)
- `Cadeau_CRM_Master_Product_Plan.md`, `Cadeau_CRM_Engineering_Standards.md`
- [docs/adr/](adr/README.md) (binding ADRs 0001–0004)
- [docs/api-conventions.md](api-conventions.md) + [docs/api/](api/README.md) (per-module contracts)
- The `11_Database.md` / `12_ERD.md` knowledge base — **reference only** (reverse-
  engineered from the legacy Supabase app, low-confidence; redesign, don't transcribe).

> This is a working plan, not a contract. If a milestone's reality differs from
> what's written here, follow the canonical sources and update this file.

---

## 0. Current state (keep this section updated)

**Done:** EPIC-1 (M1.1–M1.7), EPIC-2 (M2.1–M2.4), EPIC-3 (foundation only), EPIC-4
M4.1–M4.5 (complete — backend + frontend auth), EPIC-5 (M5.1–M5.6 — three-layer
access, backend + frontend), EPIC-6 (M6.1–M6.5 — extensible core / event bus,
backend-only). **EPIC-5 §2.5 quality gate: all eleven review dimensions PASS**
([epic-5-quality-gate.md](epic-5-quality-gate.md)); closure docs in
[access-review.md](access-review.md), [permission-matrix.md](permission-matrix.md),
[epic-5-retrospective.md](epic-5-retrospective.md). **EPIC-6 delivered** on
`feat/epic-6-core`: the in-process typed [event bus](../apps/api/src/shared/events/)
([events.md](events.md)), the EPIC-5 access stubs now emit through it (additive to
audit), the `no-ai-imports` architecture guard (ADR-0004), and
[extensibility.md](extensibility.md). **EPIC-7 delivered** on
`feat/epic-7-master-data`: the generic [master-data engine](../apps/api/src/modules/master-data/)
(one registry-driven controller/service/repository) over eight reference
collections — three system-seeded (currencies, country configs, governorates)
and five tenant-editable (units, product categories, order labels, order reasons,
shipping zones) — three-layer gated, keyset-paginated, soft-deleting, with a 60s
reference cache and the live `master_data.changed` event; plus the Master Data
frontend screen. Next: EPIC-6 + EPIC-7 §2.5 quality gates, then EPIC-8 (Products).

| Package / app      | What it is                                                                        | Status          |
| ------------------ | --------------------------------------------------------------------------------- | --------------- |
| `@cadeau/config`   | Validated typed env config (single source; no `process.env` elsewhere)            | ✅              |
| `@cadeau/database` | Prisma 6 + RLS context, keyset pagination, repository helpers, `audit_log`        | ✅ (foundation) |
| `@cadeau/crypto`   | Self-built scrypt hashing, AES-256-GCM PII encryption, HS256 JWT, TOTP (RFC-6238) | ✅              |
| `@cadeau/api`      | NestJS BFF — health, unified errors, logging, OpenAPI, layered modules            | ✅ (foundation) |
| `@cadeau/web`      | React 19 + Vite — Dual Shell (Desktop+Mobile), design system, i18n, ⌘K            | ✅ (foundation) |

**Git:** `main` = initial import (`681321a`). `feat/epic-4-auth` = EPIC-4 work.
**No git remote yet** — the owner must create the GitHub repo, `git remote add
origin <url>`, `git push`. CI runs on push to `main` and on PRs to `main`.

**Test count baseline:** 476 unit/integration after EPIC-7 (config 37 · web 80 ·
crypto 25 · database 71 · api 269). Keep it growing; never let a gate regress.

---

## 1. Ground rules every session MUST follow

### Binding decisions

- **ADR-0001 Security First** · **ADR-0002 Dual UX** · **ADR-0003 Three-Layer Access**
  · **ADR-0004 AI-out/Extensible**. Never violate; change only via a new ADR.
- **Locked stack:** React+Vite+Tailwind+shadcn/Radix · NestJS REST+OpenAPI `/v1` ·
  PostgreSQL+Prisma (self-hosted, **no Supabase**) · self-built JWT+2FA · pnpm ·
  Turborepo · Vitest · Playwright. Brand: red `#E11931` + white + neutral grays.

### Patterns to reuse (do not reinvent)

- **API:** follow [api-conventions.md](api-conventions.md) — `/v1`, raw single /
  enveloped collections, unified error envelope, **keyset pagination only**,
  `Idempotency-Key`, `camelCase` JSON, money = integer minor units, `companyId`
  never from the client.
- **Backend layering (apps/api):** `modules/<feature>/{domain,application,infrastructure,presentation}`
  - `<feature>.module.ts`. Dependencies point inward; data access only in
    `infrastructure`. Enforced by `pnpm arch:check`.
- **Tenant isolation (two layers):** repository `scopedWhere`/`stampForCreate`/
  `stampForUpdate` (`@cadeau/database`) **and** Postgres RLS. Every tenant table:
  base columns (`id`,`company_id`,`created_by`,`updated_by`,`created_at`,`updated_at`),
  `FORCE` RLS with `USING/WITH CHECK (company_id = app.current_company_id())`, and
  the `app.touch_updated_at()` trigger. See [core-data.md](core-data.md).
- **Transactions:** `withTenantTransaction(client, companyId, fn)` binds the RLS GUC.
- **Crypto:** use `@cadeau/crypto` (`hashPassword`/`verifyPassword`, `encrypt`/
  `decrypt`, `signJwt`/`verifyJwt`) — never add an external auth/JWT/crypto lib.
- **Frontend:** Dual Shell (`AppShell` picks Desktop/Mobile) — see [dual-shell.md](dual-shell.md).
  Data-driven nav, logical CSS (RTL-correct), design tokens, standard states,
  ⌘K palette, i18n ar/en (ar-first). No hover/right-click for core actions; card
  alternative for every table (ADR-0002).
- **Audit:** security-relevant changes append to `audit_log` (append-only, RLS).

### Gates (must all stay green — the definition of "done")

Run locally: `pnpm format:check` · `pnpm lint` · `pnpm type-check` · `pnpm test` ·
`pnpm build` · `pnpm arch:check` · `node scripts/check-stable-only.mjs` ·
`pnpm audit --audit-level high` · (after web build) `pnpm perf:bundle`.
**CI-only** (can't run locally — no Docker/browser/k6): `database` (migrations+RLS
on real Postgres), `e2e` (Playwright desktop+mobile + axe), `performance`
(Lighthouse desktop+mobile), `api-load` (k6), `sast` (semgrep), secret-scan.

### Dependency policy (ADR-0001)

Exact-pin versions; **stable only** (no alpha/beta/rc/next/canary). Every new dep:
`pnpm audit --audit-level high` must pass — if a transitive High appears, add a
**scoped** `pnpm.overrides` entry (precedent: `js-yaml`, `tmp`, and switching
`react-router-dom`→`react-router`). Pin GitHub Actions by SHA, containers by digest.

### Environment quirks (this workstation)

- **pnpm is not on Git Bash's PATH.** Run pnpm — and `git commit` (so husky hooks
  find pnpm) — from **PowerShell** with `$env:Path` prefixed by
  `$env:AppData\npm-global;$env:AppData\Roaming\npm-global`.
- **No Docker, no `gh`, no Playwright browser download** locally → DB/e2e/Lighthouse/
  k6 are validated in CI, not locally. Verify everything else locally + real-browser
  smoke via the preview tools when UI changes.
- Never skip hooks (`--no-verify`). Conventional Commits; end messages with the
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Branch-first
  (feature branch per epic, e.g. `feat/epic-4-auth`).

---

## 2. Standard milestone workflow (§2.6 intra-epic order)

`Backend → Testing → API Review → Frontend → UI Testing` — **no parallel FE/BE**.

1. **Read** the module contract in [docs/api/](api/README.md) and update it as you go.
2. **Schema/migration** (`@cadeau/database`): add Prisma models (public schema — no
   multiSchema), hand-write the SQL migration (table + base columns + indexes +
   `FORCE` RLS policies + `touch_updated_at` trigger). `prisma generate` locally;
   the CI `database` job validates on Postgres.
3. **Backend** (`@cadeau/api`): domain (entities/ports) → application (use-cases) →
   infrastructure (Prisma repo using `scopedWhere`/keyset/`withTenantTransaction`) →
   presentation (controller + DTOs with class-validator + OpenAPI). Gate every
   endpoint by **Subscription ∧ Feature-Flag ∧ Permission** once EPIC-5 lands.
4. **Tests:** unit (Vitest, local) for logic; e2e/DB behaviour via CI.
5. **API review:** OpenAPI matches the contract + api-conventions.
6. **Frontend:** build the screen in the Dual Shell; wire to the API; standard
   states; ar/en; Desktop **and** Mobile.
7. **UI tests:** Vitest + Testing Library (local) + Playwright specs (CI, both shells + axe).
8. **Verify all gates**, commit on the epic branch, then the **§2.5 quality gate**
   before the next epic (Security + Architecture + Code + Testing + Performance +
   owner approval).

---

## 3. Remaining milestones

### EPIC-4 — Auth + Multi-Tenancy (in progress) — `feat/epic-4-auth`

Contracts: [api/auth.md](api/auth.md), [api/tenancy.md](api/tenancy.md). No external service.

- **M4.1 Crypto foundation** ✅ — `@cadeau/crypto`.
- **M4.2 Tenancy data model** ✅ — Prisma models + migration for `profiles` (users;
  email `citext` unique; `password_hash`; PII like phone encrypted via
  `@cadeau/crypto`), `companies`, `company_members` (role, status; unique
  `(company_id,user_id)`), `sessions` (refresh-token family, `expires_at`,
  `revoked_at`), `invitations` (revocable code, `expires_at`). RLS on tenant-scoped
  tables; `profiles`/`sessions` scoped by user. Base columns + triggers throughout.
  _Acceptance:_ migration applies in CI; models generate.
- **M4.3 Auth module (NestJS)** ✅ — `POST /v1/auth/register|login|refresh|logout`,
  `GET/DELETE /v1/auth/sessions`. Password via `hashPassword/verifyPassword`;
  access+refresh JWTs via `signJwt/verifyJwt` (config secrets/TTLs/issuer);
  **refresh-token rotation** + reuse detection; a `JwtAuthGuard` + `@CurrentUser()`
  decorator; rate-limit login/refresh; audit auth events. _Acceptance:_ full
  login→refresh→logout cycle; expired/rotated tokens rejected; unified errors.
- **M4.4 2FA + invitations + multi-company.** ✅ — Self-built TOTP (`@cadeau/crypto`
  `totp.ts`: base32 + HMAC-SHA1 RFC-6238, RFC-6238 test vectors) with `POST
/v1/auth/2fa/enroll|verify` (secret stored AES-256-GCM) and a login challenge
  (`totpCode`; `401` + `details.twoFactorRequired`). New `tenancy` module: `GET
/v1/me`, `GET/POST /v1/companies`, `POST /v1/companies/{id}/switch` (both
  create+switch re-issue tenant-scoped tokens via the shared `SESSION_REISSUE`
  contract), `POST/DELETE .../invitations`, `POST /v1/invitations/accept`. Migration
  `20260731000000` adds `profiles.totp_*` and widens RLS for the tenant-bootstrap
  flows (company create, cross-tenant "my companies", invite code lookup) using the
  null-context pattern — no SECURITY DEFINER / privileged role. _Acceptance met:_
  2FA challenge; multi-company switch; revoked/expired/mis-addressed invite rejected.
- **M4.5 Frontend auth.** ✅ — Login/register screens + an inline TOTP challenge
  step (`auth/login-page`, `auth/register-page`, shared `AuthLayout`, one
  responsive layout for both shells). Session layer: `lib/api-client` (unified
  error envelope, bearer injection, single-flight refresh-and-retry on `401`,
  2FA-challenge passthrough), `auth/auth-storage` (localStorage token pair +
  derived expiry), `auth/auth-api` (typed login/register/logout/me/switch),
  `AuthProvider` + `useAuth` (hydrate-from-tokens, login/register/logout/
  switchCompany/reload), and a `RequireAuth` route guard. Company switcher wired
  into both shells; user-menu sign-out + mobile More-sheet sign-out. i18n ar/en
  for all strings. API base via `VITE_API_BASE_URL` (default
  `http://localhost:3000/v1`). _Acceptance met:_ guarded routes redirect to
  `/login` (verified live); sign-in / 2FA / switch / logout covered by unit +
  integration tests against a mocked BFF (live end-to-end needs the API + Postgres
  → CI). Gates: format/lint/type-check/web-build green; web tests 60 (coverage
  91%).

### EPIC-5 — Three-Layer Access (ADR-0003) ✅ — `feat/epic-5-access`

Contract: [api/access.md](api/access.md). Delivered M5.1–M5.6:

- **M5.1 Data + migration + seeds** ✅ — 12 models + migration `20260801000000`
  (`features`, `plans`, `plan_features`, `permissions`, `feature_permissions`,
  `permission_templates`, `role_permissions`, `subscriptions`,
  `company_feature_flags`, `add_ons`, `member_permissions`, `platform_admins`).
  Catalog tables: `FORCE` RLS with public read + null-principal seed writes; tenant
  tables: base columns + tenant RLS + `touch_updated_at`. `app.is_platform_admin()`
  widens the companies SELECT policy for the Super-Admin list. Idempotent system
  seeders for the feature catalog, permissions + feature edges, plans, and the
  **six templates**; `SUPER_ADMIN_EMAILS` config + a platform-admin seeder.
- **M5.2 Resolver + cache + guards** ✅ — `shared/access`: `AccessResolverService`
  (`Subscription ∧ Feature ∧ Permission`), `CapabilityCache` (60s TTL + explicit
  invalidation), `@RequireCapability` + `AccessGuard`, DB-backed `SuperAdminGuard`,
  global `AccessCoreModule`.
- **M5.3 Endpoints** ✅ — `modules/access`: `GET /v1/access/capabilities|features|
permission-templates`, `PUT /v1/access/members/{id}/permissions`; Super-Admin
  `GET /v1/admin/companies`, `PUT /v1/admin/companies/{id}/features/{key}`,
  `PUT /v1/admin/companies/{id}/subscription`. Every mutation audited to
  `audit_log` + cache-invalidating.
- **M5.4 FE capabilities + gates** ✅ — `CapabilitiesProvider` + `useCapabilities`,
  `<FeatureGate>`/`<PermissionGate>`, capability-filtered nav (`useNavItems`).
- **M5.5 FE Super-Admin + roles** ✅ — `/admin` (behind `RequireSuperAdmin`):
  list companies, toggle a feature live, set a plan; `/settings/roles` shows the
  templates. ar/en throughout.
- **M5.6 Tests + gates + docs** ✅ — unit tests across resolver/cache/guards/repos/
  seeders/DTOs/controllers + FE gates/provider/pages; all local gates green.

_Acceptance met:_ menus/pages/buttons/APIs gated (any-layer failure = `403`);
Super-Admin toggles a feature for a company live (cache invalidated). _Deviations:_
`add_ons`/`member_permissions`/`platform_admins` are concrete realizations of the
contract's table list; the per-member assignment **UI** is deferred pending a
tenancy members-list endpoint (the `PUT …/permissions` API is delivered + tested);
event-bus emission of `access.*`/`subscription.changed` is stubbed to audit now,
wired to the real bus in EPIC-6. DB migration + RLS and e2e are validated in CI.

### EPIC-6 — Extensible Core (ADR-0004) ✅ — `feat/epic-6-core`

**Goal.** Make the core event-driven and extension-ready **by description**
(ADR-0004: no AI, no runtime plugin loading in v1.0) so later epics emit/subscribe
domain events instead of calling each other, and so an AI import can never sneak
in. This epic wrote the plumbing EPIC-5 stubbed (the `access.*` /
`subscription.changed` emissions) and that EPIC-9/11/13/15 will depend on.
Contract: [events.md](events.md), [extensibility.md](extensibility.md).

- **M6.1 In-process Event Bus** ✅ — `apps/api/src/shared/events`: `EventBusPort`
  (`publish` + `subscribe`), a **closed typed event catalog** (`event-catalog.ts`
  — the three live `access.*`/`subscription.changed` events plus forward-declared
  `order.*`/`stock.changed`/`payment.collected` for their owning epics), and
  `InProcessEventBus` with **synchronous dispatch** + **subscriber isolation**
  (a throwing/rejecting handler is caught, logged, and skipped — never breaks the
  publisher or peers). Global `EventBusModule`. **Decision: sync-now**, documented
  in [events.md](events.md) §1; the async durable queue/retry lands in EPIC-15
  behind the same port. Unit-tested (9 cases). _Acceptance met._
- **M6.2 Wire the EPIC-5 stubs to the bus** ✅ — `AdminService.toggleFeature`/
  `setSubscription` and `AccessService.assignMemberPermissions` now
  `eventBus.publish(...)` **alongside** the durable audit write (audit stays the
  source of truth; the bus is additive), after cache invalidation. Emitter tests
  assert the published event; all access tests green.
- **M6.3 Extension points + plugin registry (description only, §15.7)** ✅ —
  [extensibility.md](extensibility.md): the described `ExtensionPoint` contract and
  the three real seams (event bus, feature catalog, permission catalog), how a
  future module / paid add-on / AI plugin attaches without core changes, **no
  dynamic code loading**. `ai` feature stays **inactive** in the catalog.
- **M6.4 AI-import guard (CI, ADR-0004)** ✅ — `no-ai-imports`
  `dependency-cruiser` rule (forbids `@anthropic-ai/*`, `openai`, Azure/Google/
  Vertex, `@mistralai`, `langchain`, `llamaindex`, `cohere-ai`, `@huggingface`,
  `replicate`, `groq-sdk`, `ollama`, Bedrock — incl. **unresolved** and
  **type-only** imports), wired into `arch:check`/CI. Verified: a planted `openai`
  import failed the gate; clean tree passes (329→327 modules, 0 violations).
- **M6.5 Tests + gates + docs** ✅ — bus unit tests; [events.md](events.md),
  [extensibility.md](extensibility.md), [architecture-tests.md](architecture-tests.md)
  updated; this plan + [api/access.md](api/access.md) "Events emitted" point at
  the live bus; all local gates green.

_Acceptance met:_ events emit/subscribe with subscriber isolation; the EPIC-5
access events flow through the bus; the AI-import guard blocks a planted import;
extension points documented; `AI` flag OFF. Then the §2.5 quality gate.

### EPIC-7 — Master Data ✅ — `feat/epic-7-master-data`

Contract: [api/master-data.md](api/master-data.md). Delivered M7.1–M7.5:

- **M7.1 Data + migration + seeds** ✅ — 8 models + migration `20260802000000`.
  System reference (public-read + null-context seed writes): `currencies`,
  `country_configs`, `governorates`. Tenant-editable (base columns + `FORCE` RLS
  - `touch_updated_at`): `units`, `product_categories`, `order_labels`,
    `order_reasons`, `shipping_zones`. Deletes are soft (`is_active`). Idempotent
    system seeders (currencies, EG/SA/AE country configs, Egypt's 27 governorates)
    registered in `SYSTEM_SEEDERS`.
- **M7.2 Backend engine** ✅ — a generic, registry-driven master-data engine
  under `/v1/master-data` (`modules/master-data`): one controller/service/generic
  Prisma repository reads a `ResourceDescriptor` per collection. Three-layer gated
  (`master-data.read`/`master-data.manage` under the `master-data` feature),
  keyset pagination, whitelisted filters/sort, manual validation to the
  api-conventions §4 field-error shape, same-tenant reference checks, soft-delete,
  and a 60s reference cache. Every write records a durable `audit_log` row,
  invalidates the cache, and emits the new `master_data.changed` domain event
  (added to the EPIC-6 catalog). System resources reject writes (`403`).
- **M7.3 Tests + gates** ✅ — unit tests across registry/validation/list-query/
  cache/service/repository/controller + seeder tests; all local gates green
  (api 179→269, database 67→71).
- **M7.4 Frontend** ✅ — a capability-gated Master Data screen in the Dual Shell
  (`pages/master-data`, `features/master-data`): resource switcher, responsive
  card list (card alternative for both shells), create/edit/deactivate for the
  tenant resources, read-only system resources, standard states, ar/en, nav +
  route. Vitest + Testing Library specs against a mocked BFF.
- **M7.5 Docs + gates** ✅ — [api/master-data.md](api/master-data.md) marked
  delivered (resource-by-resource, endpoints, filters/sort, events, caching),
  [events.md](events.md) lists `master_data.changed` live, this plan updated.

_Acceptance met:_ CRUD + cache; system tables system-seeded (idempotent, read-only
via API) vs tenant-editable; a cached reference source for later modules; every
write emits `master_data.changed`. DB migration + RLS validated in CI. Then the
§2.5 quality gate.

### EPIC-8 — Products

Contract: [api/products.md](api/products.md). Catalog + variants
(`parent_product_id`, cascading selects), SKU/barcode field, moving-average cost /
COGS per variant, dual view (table/cards). _Depends on:_ EPIC-7.

### EPIC-9 — Inventory & Warehouses

Contract: [api/inventory.md](api/inventory.md). `inventories` + `inventory_stock`
(`on_hand`/`committed`/`available`), **atomic** reserve/release tied to order state,
**atomic** transfers + log, numbered low-stock alerts, oversell policy. _Depends on:_ 8.

### EPIC-10 — Customers

Contract: [api/customers.md](api/customers.md). Profile + KPIs + order history,
**E.164 uniqueness per company** (unique index), manual merge, restricted+audited
export, consistent currency. _Depends on:_ 7 (+ orders later).

### EPIC-11 — Orders

Contract: [api/orders.md](api/orders.md). 12-state lifecycle + separate follow-up
state, **deterministic smart-paste (Regex/Heuristics — no AI)**, dual view + saved
filters, inline + bulk status/assign, side detail panel, pivotal `collectedAmount`,
labels/reasons, **keyset + deep-linking**, Excel/CSV import with column mapping,
full activity log, configurable state machine (P1). _Depends on:_ 8, 9, 10.

### EPIC-12 — Shipping

Contract: [api/shipping.md](api/shipping.md). **Carrier abstraction** + Egyptian
integration (Bosta, …), bulk shipping + waybills, configurable zones, **reliable
webhooks** (queue + retry, idempotent on carrier event id), in-order tracking,
shipping-fee deduction from collected. _Depends on:_ 11.

### EPIC-13 — Finance & Compliance

Contract: [api/finance.md](api/finance.md). Suppliers + POs (partial pay/receive;
**atomic receipt raises stock**), unified expenses, **official PDF invoices**,
configurable VAT, refunds, **working shipping reconciliation**, cash center +
**atomic sequential monthly close**, P&L + period comparison. Money = integer minor
units. _Depends on:_ 8, 9, 11, 12.

### EPIC-14 — Analytics

Contract: [api/analytics.md](api/analytics.md). Five axes (business/products/
inventory/staff/profitability), net income on collected − COGS, **actually-computed**
deltas, restricted+audited export, time filter + sparklines, one decomposed cached
query per tab. _Depends on:_ most domain epics.

### EPIC-15 — Notifications

Contract: [api/notifications.md](api/notifications.md). Notification center + Web
Push, typed notifications, end-customer WhatsApp/SMS on status change, per-user
preferences, reliable delivery queue. _Depends on:_ the event bus (EPIC-6) + orders.

### EPIC-16 — Launch Gate

Every Empty/Loading/Error state · full localization + real RTL · perf P95<2s +
keyset everywhere · WCAG AA · **penetration test** (permission bypass via API) ·
**pre-deployment security checklist** · verify all launch gates (§31, incl.
ADR-0001..0004).

---

## 4. Definition of done (per milestone & per epic)

- **Milestone:** all local gates green; new behaviour unit-tested; contract +
  OpenAPI updated; CI-only parts wired (DB migration / Playwright / Lighthouse / k6
  as relevant); committed on the epic branch with a Conventional Commit.
- **Epic:** the §2.5 quality gate — Security review, Architecture review, Code
  review, Testing, Performance (§2.4 budgets green), and **explicit owner approval**
  — before starting the next epic.
