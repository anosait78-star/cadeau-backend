# Notifications API Contract

**Status:** ✅ Delivered — **EPIC-15** · **Base path:** `/v1/notifications` ·
**Feature key:** `notifications` · **Access:** authenticated + gated (feature
only, no permission key — decision D1)

An in-app notification center fed by the EPIC-6 event bus, reliable Web Push
delivery, per-user per-type per-channel preferences, and a deferred-but-wired
end-customer messaging seam. Follows [../api-conventions.md](../api-conventions.md).
Design: [../epic-15-design.md](../epic-15-design.md).

## Resources

- `Notification` — an in-app notification (type, title, body, payload, read state).
- `NotificationPreference` — per-user, per-type, per-channel (`inApp`/`webPush`) settings.
- `PushSubscription` — a registered Web Push endpoint (W3C `PushSubscription` shape).

## Endpoints

| Method | Path                                        | Purpose                                       | Gate                              |
| ------ | ------------------------------------------- | --------------------------------------------- | --------------------------------- |
| GET    | `/v1/notifications`                         | List the caller's own notifications (keyset). | `notifications` feature only (D1) |
| POST   | `/v1/notifications/read`                    | Mark one/many of the caller's own read.       | `notifications` feature only      |
| GET    | `/v1/notifications/preferences`             | Get the caller's own channel preferences.     | `notifications` feature only      |
| PUT    | `/v1/notifications/preferences`             | Update the caller's own channel preferences.  | `notifications` feature only      |
| POST   | `/v1/notifications/push/subscriptions`      | Register a Web Push endpoint for the caller.  | `notifications` feature only      |
| DELETE | `/v1/notifications/push/subscriptions/{id}` | Remove a push endpoint owned by the caller.   | `notifications` feature only      |

Every route requires `JwtAuthGuard` + the `notifications` feature being active
for the company — **no `notifications.read`/`notifications.manage` permission
check anywhere in this module** (D1): these are exclusively the caller's own
data, so gating by a role permission would let one role block a teammate from
managing their own settings, the same reasoning `GET /v1/me` follows. The
`notifications.read`/`.manage` keys the EPIC-5 catalog auto-generates for every
`PERMISSIONED_FEATURES` entry stay reserved/unused by this epic.

## List parameters

- Filter: `type` (`order.status_changed` | `payment.collected`), `read`
  (`true`/`false`), `createdAtFrom`/`createdAtTo`.
- Sort is fixed: `-createdAt, id` (no client-chosen sort — unlike every other
  list endpoint in the app).
- `POST /v1/notifications/read` body: `{ "ids": string[] }` (max 100). No
  `Idempotency-Key` header — marking an already-read or foreign id is a
  silent no-op, not an error (D8), so the write is naturally idempotent.

## Events emitted (ADR-004)

- `notification.created` — after the `Notification` row commits, alongside its
  durable audit write. System-originated (`actorId: null`).
- `notification.delivered` — edge-triggered when a `notification_deliveries`
  row reaches `processed`.
- **Consumes** `order.status_changed` and `payment.collected` (the closed
  event catalog's first real subscriber, EPIC-6 M6.1). `stock.low` fan-out is
  explicitly deferred (D7) — its recipient ("everyone with
  `inventory.manage`") needs a company-wide member-permission broadcast
  primitive that doesn't exist yet.

## Delivery

- `notification_deliveries` is a DB-backed outbound queue — one row per
  (notification, push subscription) — processed by a retry worker with
  exponential backoff (30s base, doubling, capped at 1h, parked after 10
  attempts), copying the EPIC-12 `shipping_webhook_events`/`WebhookRetryWorker`
  shape exactly, applied to outbound sends instead of inbound webhooks (D2).
- Web Push sends are VAPID-authenticated (RFC 8292) via the `web-push` npm
  package (D4); the VAPID key pair is self-generated server key material
  (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`, required config —
  not a third-party credential).
- A push subscription that the browser's push service reports gone (404/410)
  is deleted outright; every other pending delivery for it cascades away with
  it (`ON DELETE CASCADE`).

## Recipient resolution

The recipient of a fan-out notification is the order's `assigneeId`
(`orders.assigneeId`, read back tenant-bound since the event payload carries
only `orderId`). An unassigned order is a silent no-op — no row, no audit,
nothing queued (D9), matching the "unassigned bucket" tolerance EPIC-14/D8
established for the same field.

## End-customer messaging

`CustomerMessagingPort` is wired to `order.status_changed`, but the only bound
adapter is `LoggingCustomerMessagingAdapter` — it logs and sends nothing
(`sent: false`). Mirrors EPIC-12/D1 (`CarrierPort` + `ManualCarrierAdapter`):
no vetted WhatsApp/SMS provider credentials exist in this environment. A real
adapter is a drop-in swap; `WHATSAPP_API_KEY` (already in the config schema,
unused since it was added) stays reserved for it.

## Deviations from the draft contract

- Permission model simplified to **feature-only** gating (D1) — the draft's
  bare "authenticated" access note is realized as `RequireCapability({
feature: "notifications" })`, no permission key, rather than the `read`/
  `manage` convention every other module uses.
- `stock.low` is **not** consumed (D7, deferred — see above).
- No bespoke rate-limiting on end-customer messaging: with no real provider
  wired (D5), there is nothing to rate-limit yet; `CustomerMessagingPort`'s
  `{ sent: boolean }` result reserves room for a future `rateLimited` outcome.
