# EPIC-15 Quality Gate (§2.5) — Notifications

**Epic:** EPIC-15 Notifications · **Branch:** `feat/epic-15-notifications` ·
**Gate run:** 2026-08-01.

The mandatory post-epic quality gate: Security · Architecture · Code ·
Testing · Performance · API/Contract · Documentation · Extensibility ·
AI-out — plus **owner approval**. No new epic starts until every dimension
passes and the owner signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                                                                                                                                       |
| ----------------- | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Security          | ✅ PASS | Feature-only gate (D1, deliberately no permission key — personal data); tenant from token; RLS + repo-scoped by `profileId`; VAPID keys required config, self-generated, never third-party |
| Architecture      | ✅ PASS | 4-layer module; one arch violation caught and fixed during the build (see §6); `arch:check` green with 0 violations at gate time                                                           |
| Code              | ✅ PASS | Strict TS, no `any`; retry/backoff logic is pure, unit-tested exhaustively (copies the EPIC-12 shape)                                                                                      |
| Testing           | ✅ PASS | Full monorepo `pnpm test` green from a cold cache; +89 api tests, +16 web tests, +3 config tests over the EPIC-14 baseline                                                                 |
| Performance       | ✅ PASS | Two new keyset/poll indexes (recipient, pending-delivery); web bundle 172.0 KB / 200 KB gzip                                                                                               |
| API / Contract    | ✅ PASS | [api/notifications.md](api/notifications.md) matches the 6 delivered routes                                                                                                                |
| Documentation     | ✅ PASS | design, contract, domain, this gate; `events.md`/execution-plan refreshed                                                                                                                  |
| Extensibility     | ✅ PASS | First real bus subscriber, no bus API change (D3); `stock.low` fan-out and real WhatsApp/SMS explicitly deferred with a named reason                                                       |
| AI-out (ADR-0004) | ✅ PASS | No AI dependency; `no-ai-imports` guard green; every retry decision is deterministic backoff arithmetic                                                                                    |

**Local gates (this run):** `format:check` ✅ · `lint` ✅ · `type-check` ✅
(8/8) · `test` ✅ (config 46 · crypto 47 · database 71 · web 200 · api 1238 =
**1602**, up from 1494 at EPIC-14 close) · `build` ✅ (5/5) · `arch:check` ✅
(638 modules, 1772 deps, 0 violations) · `audit --audit-level high` ✅ (0
high/critical; 1 pre-existing moderate, unchanged) · `perf:bundle` ✅
(`@cadeau/web` 172.0 KB / 200 KB gzip, up from 170.4 KB — the bell + dropdown

- preferences page cost ~1.6 KB gzip) · `database` migration applied cleanly
  against a real local Postgres (`docker compose up -d db`, `prisma migrate
deploy` — 16 migrations, this epic's `20260811000000_notifications` included).

**CI-only gates:** `e2e` (Playwright desktop+mobile + axe), `performance`
(Lighthouse), `api-load` (k6), `sast`, secret-scan — run on push/PR to
`main`. Not attempted or faked on this workstation (no browser/k6 available
locally); the `database` gate itself _was_ run locally this time since
Docker is available (see [database.md](database.md#local-development)).

---

## 1. Security

- Every route: `JwtAuthGuard` + `RequireCapability({ feature: "notifications" })`
  — deliberately **no permission key** (D1). This is intentional, not an
  oversight: gating a user's own inbox/preferences by a role permission
  would let one role block a teammate from muting their own notifications.
- Every repository method takes `profileId` from the authenticated
  principal, never from a path or query parameter — no cross-user read
  exists anywhere in this module.
- `notification_deliveries`' RLS is split INSERT (strict, tenant-bound) /
  SELECT+UPDATE (additionally widened for the null-tenant retry-worker
  claim) — the same pattern as `shipping_webhook_events` post-M12.4, applied
  correctly from the first migration this time (no follow-up migration
  needed).
- VAPID keys (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) are required,
  self-generated secrets, checked for placeholder values in production
  hardening (`packages/config/src/schema.ts`) exactly like
  `ENCRYPTION_KEY`/`PII_HASH_KEY`/`SHIPPING_WEBHOOK_SIGNING_SECRET`.
- `notification.created`'s audit `changes` carries `type`/`recipientProfileId`
  only — no title/body text (which could echo order details) goes into the
  durable audit row.

## 2. Architecture

- `modules/notifications/{domain,application,infrastructure,presentation}`,
  dependencies pointing inward, data access only in `infrastructure`.
- **One violation was introduced and caught during the build**, not
  deferred to the gate: `NotificationDispatchService` (application layer)
  originally injected `NOTIFICATIONS_PRISMA_CLIENT` (an infrastructure
  token) directly to read back order facts. `arch:check`'s
  `layer-application-no-outer` rule flagged it immediately. Fix: a new
  `OrderFactsPort`/`OrderFactsAdapter` pair — the standard port +
  infrastructure-adapter shape, not an exception or a suppressed rule. A
  second, unrelated violation (`packages/database/prisma/seed-demo.ts`
  deep-importing `../../crypto/src/index` instead of the `@cadeau/crypto`
  package — leftover from a prior session's local-verification work, not
  written this epic) was fixed the same way: added `@cadeau/crypto` as a
  proper workspace dependency.
- `DeliveryQueueRepository`/`DeliveryRetryWorker`/`DeliveryProcessorService`
  mirror `WebhookInboxRepository`/`WebhookRetryWorker`/`WebhookProcessorService`
  (EPIC-12) field-for-field, applied to an outbound queue — deliberate
  duplication of a proven shape, not a shared abstraction reached for
  prematurely (cross-feature imports are architecturally forbidden anyway).

## 3. Code

- Strict TypeScript, no `any`. `delivery-retry-policy.ts` is a pure
  copy-with-rename of the EPIC-12 policy (same constants, same curve),
  unit-tested including the `attempts=0` and exhausted-budget edges.
- `WebPushAdapter` maps only 404/410 to `PushSubscriptionGoneError`; every
  other failure (network, 429, 5xx) falls through to the generic
  backoff-and-retry path, verified by dedicated tests for each branch.
- `NotificationDispatchService.dispatch` wraps its whole body in a
  try/catch that logs and swallows — the bus already guarantees subscriber
  isolation, but a handler that awaited multiple I/O calls before returning
  is exactly the shape where an unhandled rejection could otherwise surface
  as an unhandled promise rejection outside the bus's own catch.

## 4. Testing

Full monorepo suite green from a cold cache: **1602 tests** (config 46 ·
crypto 47 · database 71 · web 200 · api 1238), up from 1494 at EPIC-14
close. New coverage: the retry/backoff policy, the delivery queue repository
(claim/mark/join, including a claimed row whose notification or subscription
was deleted mid-flight), the Web Push adapter (VAPID call, 404/410 mapping,
other-error passthrough), the dispatch service (both consumed events, the
no-assignee/no-order/both-channels-disabled/webPush-only branches, subscriber
isolation on a thrown error), the delivery processor (success/gone/failure/
multi-item batches), the personal-endpoints service and controller, and the
`OrderFactsAdapter`. Frontend: the notifications API client (query building),
the bell (unread indicator, panel load, mark-read, mark-all-read — each
verified against the actual outgoing request body), and the preferences page
(load/toggle/save/error). Both package-wide coverage thresholds (`apps/api`:
90/90/85/90, `apps/web`: 75/75/70/75) were met on the first full run.
DB/RLS migration applied and verified against a real local Postgres; e2e
runs in CI.

## 5. Performance

- `notifications_recipient_keyset_idx (company_id, profile_id, created_at
DESC, id DESC)` backs both the personal list endpoint and the bell's
  unread-poll query.
- `notification_deliveries_pending_idx (status, next_attempt_at)` backs the
  retry worker's claim query, identical in shape to
  `shipping_webhook_events_pending_idx`.
- Web bundle 172.0 KB gzip (170.4 KB before this epic) — the bell, dropdown
  panel, and preferences page cost ~1.6 KB gzip, no new frontend dependency
  (`lucide-react`'s `Bell` icon and the already-installed
  `@radix-ui/react-dropdown-menu` were reused).
- The retry worker polls every 5s (matching `WebhookRetryWorker`) and is
  skipped entirely under test (`config.isTest`), same guard as its shipping
  counterpart.

## 6. Deviations (all recorded in the design doc / contract)

- Personal-endpoint permission model is feature-only (D1) — a deliberate
  departure from the `read`/`manage` convention every other module uses,
  because this module has no cross-user read to gate.
- `stock.low` fan-out deferred (D7) — no company-wide member-permission
  broadcast primitive exists yet.
- Real WhatsApp/SMS provider integration deferred (D5) — only the port +
  a logging stub ship, mirroring EPIC-12/D1.
- No actual browser Web Push subscription flow in the frontend (no
  service-worker asset) — the `webPushEnabled` preference toggle and the
  `POST`/`DELETE .../push/subscriptions` endpoints are real and tested, but
  nothing in this pass calls `pushManager.subscribe()` from the browser.
  Flagged in the design doc §3 as a frontend-build concern outside this
  backend-first epic.
- One architecture violation was introduced and fixed during the build
  (§2) — recorded here per the EPIC-13 retrospective's precedent of naming
  build-time issues in the gate doc, not just the final green state.

---

## 7. Owner approval

> **Status:** ⏳ **Pending.** Every technical dimension above is verified
> PASS against the actual local gate output (not asserted from memory), but
> owner sign-off is a separate, explicit checkpoint this document cannot
> grant on the owner's behalf — unlike the design-decision precedent
> (EPIC-14 §title: "no owner round-trip blocked this draft"), closing an
> epic and unblocking EPIC-16 requires the owner's own approval.

| Reviewer | Role  | Decision | Date |
| -------- | ----- | -------- | ---- |
| Owner    | Owner | —        | —    |
