# EPIC-15 Design — Notifications

**Status:** 🟡 **Design in progress on `feat/epic-15-notifications`** — decisions
D1–D9 recorded below, made against established repo precedent (no owner
round-trip blocked this draft, following the EPIC-14 precedent). **Drafted:**
2026-08-01.

This document fixes the **scope, boundaries, decisions and acceptance
criteria** of EPIC-15 — an in-app notification center with reliable Web Push
delivery, per-user preferences, and a deferred-but-wired end-customer
messaging seam, all fed by the EPIC-6 event bus. Contract:
[api/notifications.md](api/notifications.md). Depends on: the event bus
(EPIC-6) + orders (EPIC-11).

---

## 1. Goal

Every domain epic through EPIC-14 publishes facts onto the EPIC-6 event bus,
but nothing has ever subscribed to them — the bus has had publishers only.
EPIC-15 is the **first real subscriber**: a notification center that turns
`order.status_changed` / `payment.collected` into an in-app inbox item for
the right staff member, delivers it to their browser via Web Push when they
are not looking, and remembers what each user wants to hear about and on
which channel.

## 2. In scope

- **`GET /v1/notifications`** — the caller's own notifications, keyset-paged,
  filterable by `type`/`read`/`createdAtFrom`/`createdAtTo`.
- **`POST /v1/notifications/read`** — mark one or many of the caller's own
  notifications read (`Idempotency-Key`-free; marking an already-read row
  read again is a no-op, not an error — see D8).
- **`GET`/`PUT /v1/notifications/preferences`** — per-user, per-type,
  per-channel (`inApp`/`webPush`) on/off switches.
- **`POST /v1/notifications/push/subscriptions`** /
  **`DELETE /v1/notifications/push/subscriptions/{id}`** — register/remove a
  Web Push endpoint (standard W3C Push API subscription object: `endpoint` +
  `keys.p256dh` + `keys.auth`).
- **Two live event-bus subscriptions** (D6): `order.status_changed` and
  `payment.collected`. Each creates one `Notification` row for the order's
  `assigneeId` (when set) and, if that user has Web Push enabled for the
  type, enqueues one `notification_deliveries` row per their active push
  subscriptions.
- **A reliable delivery queue** (D2) — `notification_deliveries`, a DB-backed
  outbox processed by a retry worker with exponential backoff, copying the
  EPIC-12 `shipping_webhook_events`/`WebhookRetryWorker` pattern exactly
  (`FOR UPDATE SKIP LOCKED`, same backoff curve). This is the "async durable
  queue/retry behind the `EventBusPort`" that `events.md` §1 forward-declared
  for this epic — it queues **outbound Web Push sends**, not bus dispatch
  itself (D3 explains why the bus stays synchronous).
- **A real Web Push send** (D4): VAPID-authenticated, RFC 8030/8291
  encrypted, via the `web-push` npm package.
- **`notification.created`/`notification.delivered`** added to the closed
  event catalog and emitted live.
- **A `CustomerMessagingPort` seam** for end-customer WhatsApp/SMS (D5),
  wired to the same two order events, but shipped with a
  logging-only adapter — no real provider call goes out in v1.
- **The Notifications Dual Shell screen**: a bell icon with an unread badge,
  a dropdown/sheet list, mark-read, and a preferences panel — Desktop and
  Mobile, ar/en.

## 3. Explicitly out of scope

| Not in EPIC-15                                         | Why / where                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock.low` fan-out                                    | D7 — its natural recipient is "everyone with `inventory.manage`", which needs a company-wide member-permission broadcast primitive (resolve every member's effective capabilities, not just one FK). No such primitive exists yet. The event catalog subscription slot is easy to add once it does; not blocking this epic. |
| A real WhatsApp/SMS provider integration               | D5 — mirrors EPIC-12/D1 (`CarrierPort` + `ManualCarrierAdapter`, real Bosta deferred): no vetted provider credentials exist in this environment. `CustomerMessagingPort` ships; only the adapter is a stub.                                                                                                                 |
| A general-purpose broadcast/announcement API           | Not in the draft contract; every notification in v1 is system-generated from a bus event, never authored ad hoc by a user                                                                                                                                                                                                   |
| Push-notification click-through deep-linking in the SW | The stored `payload` carries the ids a future service-worker `notificationclick` handler would need, but shipping an actual service-worker asset is a frontend-build concern outside this backend-first epic; the web app's push subscription registration is in scope, the SW itself is a documented follow-up             |
| SMS/WhatsApp per-message rate limiting                 | The contract's "notes" mention it, but with no real provider wired (D5) there is nothing to rate-limit yet; the port signature reserves a `rateLimited` outcome for when a real adapter lands                                                                                                                               |
| A `notifications.manage`-gated admin broadcast UI      | Same reasoning as `stock.low` — no company-wide send primitive yet                                                                                                                                                                                                                                                          |

## 4. Decisions

| #   | Decision                          | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Personal-endpoint gating          | Every `/v1/notifications/*` route requires a valid JWT (`JwtAuthGuard`) plus the `notifications` **feature** being active for the company (`RequireCapability({ feature: "notifications" })`, **no permission key**). These are the caller's own data — like `GET /v1/me` (`tenancy.controller.ts`), which carries no `RequireCapability` at all — so gating by a role permission would be wrong (it would let a role block a teammate from muting their own push notifications). The `notifications.read`/`notifications.manage` permission keys the EPIC-5 catalog already auto-generates for every entry in `PERMISSIONED_FEATURES` stay reserved/unused by this epic, same as other epics have left catalog rows dormant pending a feature that needs them (e.g. EPIC-13/D2 never used `finance.refund`/`finance.close`).                                                                                |
| D2  | Reliable delivery queue           | A DB-backed outbox table, `notification_deliveries`, one row per (notification, push subscription), processed by a retry worker — **the exact `shipping_webhook_events` / `WebhookRetryWorker` shape from EPIC-12 M12.4**, copied field-for-field (`status` pending/processing/processed/failed, `attempts`, `next_attempt_at`, `FOR UPDATE SKIP LOCKED` claim, same backoff curve: 30s base, doubling, capped at 1h, parked after 10 attempts). No new infrastructure dependency (no Redis/SQS) — consistent with every prior epic's "no new queue" decisions (EPIC-12/D2, EPIC-13's DB-backed reconciliation).                                                                                                                                                                                                                                                                                             |
| D3  | Event bus stays synchronous       | The in-process `InProcessEventBus` (EPIC-6) is **not** changed. `events.md` §1 said EPIC-15's durable queue would land "behind the same port" — read as: the _outbound delivery_ this epic adds is durable and retried (D2), not that bus dispatch itself becomes async. Making the bus durable/async would touch every existing publisher and subscriber-isolation guarantee for a benefit this epic doesn't need: the notification-creation handler's own DB write (the `Notification` row) is the source of truth, and it is that row — not the in-memory event — that the retry worker replays from. If the process crashes between publish and the handler's write, the in-app notification is lost exactly like today's synchronous audit writes would be if the process crashed mid-request; this is the same durability envelope every other subscriber-less publisher has always had, and no worse. |
| D4  | Web Push library                  | **`web-push`** (npm), pure-JS VAPID/RFC-8291 implementation, no native compile step — same reasoning template as EPIC-13/D1's `pdfkit` choice (pure-JS, no headless-browser/native-binary attack surface, MIT-licensed, the standard Node choice for this exact protocol). VAPID keys (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`) are **self-generated key material**, not a third-party credential (no account/API key/SaaS involved — the browser vendor's push service is a W3C-standardized endpoint, addressed directly), so they join `ENCRYPTION_KEY`/`PII_HASH_KEY`/`SHIPPING_WEBHOOK_SIGNING_SECRET` as **required** config, not optional-third-party-key config like `WHATSAPP_API_KEY`.                                                                                                                                                                                              |
| D5  | End-customer messaging            | `CustomerMessagingPort` (`send(companyId, phone, template, params): Promise<{ sent: boolean }>`) is defined and wired to `order.status_changed`, but the only bound adapter is `LoggingCustomerMessagingAdapter` — it writes a structured log line and returns `{ sent: false }`, sending nothing. Mirrors EPIC-12/D1 exactly (`CarrierPort` + `ManualCarrierAdapter`, real carrier deferred). `WHATSAPP_API_KEY` (already in the config schema, unused since it was added) stays reserved for the real adapter.                                                                                                                                                                                                                                                                                                                                                                                             |
| D6  | Which bus events are consumed     | `order.status_changed` and `payment.collected` only (D7 explains why not `stock.low`). Both carry `orderId`; the subscriber reads the order back (`assigneeId`, `orderNumber`) via a direct Prisma read on the already-committed row — every existing publisher records its durable audit write and commits its own transaction **before** calling `eventBus.publish` (verified against `orders.service.ts`'s `recordTransition`), so the row is always visible by the time a synchronous in-process handler runs.                                                                                                                                                                                                                                                                                                                                                                                           |
| D7  | `stock.low` deferred              | See §3. Reserved: the event catalog documents the intended future subscription so a later epic (or a follow-up decision) can add it without re-litigating the shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D8  | Mark-read idempotency             | `POST /v1/notifications/read` takes `{ ids: string[] }` (max 100, api-conventions bulk-shape precedent) and sets `readAt = now()` only on unread rows the caller owns; already-read or foreign ids are silently skipped (not `404`/`409`) — marking read is naturally idempotent, so no `Idempotency-Key` header is needed here (unlike a financial or stock-moving write).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D9  | Recipient resolution failure mode | If an order has no `assigneeId` (unassigned), the event is a no-op for notifications — no row, no audit, nothing queued. This is a silent skip, not an error, matching the "unassigned bucket" tolerance EPIC-14/D8 established for the same field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 5. Acceptance criteria

- `GET /v1/notifications` returns only the caller's own rows, keyset-paged,
  gated by the `notifications` feature only (no permission key — D1).
- A `order.status_changed` or `payment.collected` event with a known
  `assigneeId` produces exactly one `Notification` row for that user within
  the same process tick (synchronous dispatch, subscriber-isolated — a
  throwing handler never breaks the publisher, per the existing
  `InProcessEventBus` guarantee).
- A user with Web Push enabled for that type and at least one active
  subscription gets one `notification_deliveries` row per subscription;
  the retry worker eventually marks each `processed` or, after 10 attempts,
  parks it `failed` — verified by fixture-backed unit tests against the
  claim/backoff logic, copying the EPIC-12 test shapes.
- `notification.created` is emitted (audit-then-emit, like every other
  module) when the row is created; `notification.delivered` is emitted when
  a `notification_deliveries` row reaches `processed`.
- No AI/ML anywhere in the module (`no-ai-imports` arch guard).
- The Dual Shell frontend shows an unread badge, a list, mark-read, and a
  preferences panel on both shells, ar/en, within the 200KB gzip bundle
  budget.

## 6. Milestones

- **M15.0** — this design doc (this commit).
- **M15.1** — schema + migration: `notifications`, `notification_preferences`,
  `push_subscriptions`, `notification_deliveries` (four tenant tables, base
  columns + FORCE RLS + `touch_updated_at`, `notification_deliveries`
  additionally split insert/select/update like the EPIC-12 M12.4 precedent
  since the retry worker's cross-tenant claim is known up front this time —
  no need for a second migration). Config: `VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` added to `@cadeau/config` as required
  secrets.
- **M15.2** — backend: domain ports/errors, `NotificationsService`
  (list/markRead/preferences/subscriptions), `NotificationDispatchService`
  (the bus subscriber — creates the row + enqueues deliveries +
  `CustomerMessagingPort` call), `WebPushAdapter` (`web-push`-backed),
  `LoggingCustomerMessagingAdapter`, the delivery retry worker (copy of
  `WebhookRetryWorker`), presentation (`/v1/notifications/*` controller +
  DTOs), `notification.created`/`.delivered` added to the event catalog.
- **M15.3** — unit tests across domain/application/infrastructure/
  presentation, mirroring the EPIC-12 webhook-inbox test shapes for the
  retry queue.
- **M15.4** — frontend: the Notifications bell + list + preferences in the
  Dual Shell.
- **M15.5** — docs + gates: contract as-built, `events.md` update, this plan
  refreshed, quality gate.
