# Notifications Domain (EPIC-15)

**Code:** [`apps/api/src/modules/notifications/`](../apps/api/src/modules/notifications/)
· **Contract:** [api/notifications.md](api/notifications.md) · **Design:**
[epic-15-design.md](epic-15-design.md)

## 1. Shape

Four tenant tables (all base columns + FORCE RLS + `touch_updated_at`,
migration `20260811000000_notifications`):

- **`notifications`** — one in-app inbox row per (company, recipient).
  `type` is a closed set (`order.status_changed` | `payment.collected`).
  Keyset index `(company_id, profile_id, created_at DESC, id DESC)`.
- **`notification_preferences`** — per (company, profile, type):
  `in_app_enabled`/`web_push_enabled`, both default `true`. A missing row for
  a type means both channels are enabled by default.
- **`push_subscriptions`** — a registered W3C Web Push endpoint. `endpoint`
  is globally unique (one browser installation).
- **`notification_deliveries`** — the durable outbound Web Push send queue,
  one row per (notification, push subscription). RLS is split
  INSERT/SELECT/UPDATE from the start (unlike `shipping_webhook_events`,
  which needed a follow-up M12.4 migration to discover this need) so the
  retry worker's cross-tenant claim is permitted from day one.

## 2. Flow

```
order.status_changed / payment.collected (bus event, already committed)
        │
        ▼
NotificationDispatchService (first real bus subscriber, EPIC-6 M6.1)
        │  reads orders.assigneeId/orderNumber via OrderFactsPort
        │  (no assignee → silent no-op, D9)
        ▼
  checks NotificationPreference for (recipient, type)
        │
        ├─ inApp enabled ─→ NotificationsRepository.create → audit → publish
        │                    notification.created
        │
        └─ webPush enabled ─→ enqueue one notification_deliveries row per
                               active push subscription
                                    │
                                    ▼
                          DeliveryRetryWorker (5s poll, skipped under test)
                                    │
                                    ▼
                          DeliveryProcessorService.processBatch
                                    │  claims via FOR UPDATE SKIP LOCKED
                                    │  (no tenant bound — platform-level)
                                    ▼
                          WebPushAdapter.send (web-push, VAPID)
                            ├─ success → markProcessed, publish
                            │            notification.delivered
                            ├─ 404/410 (PushSubscriptionGoneError)
                            │            → delete subscription, cascades
                            │              every other pending delivery for it
                            └─ other error → markFailed, exponential backoff
                                              (30s → … → 1h, parked after 10)
```

`order.status_changed` additionally calls `CustomerMessagingPort.send` —
bound today to `LoggingCustomerMessagingAdapter` (logs only, sends nothing,
D5).

## 3. Ports (domain layer)

| Port                          | Bound implementation              | Purpose                                                      |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `NotificationsRepositoryPort` | `NotificationsRepository`         | Personal-data CRUD (list/markRead/preferences/subscriptions) |
| `DeliveryQueuePort`           | `DeliveryQueueRepository`         | The durable outbound queue (enqueue/claim/mark)              |
| `PushSenderPort`              | `WebPushAdapter`                  | One Web Push send (VAPID)                                    |
| `CustomerMessagingPort`       | `LoggingCustomerMessagingAdapter` | End-customer message (stub — D5)                             |
| `NotificationsAuditPort`      | `NotificationsAuditLogAdapter`    | Durable `audit_log` write for `notification.created`         |
| `OrderFactsPort`              | `OrderFactsAdapter`               | Reads `orders.assigneeId`/`orderNumber` (D6)                 |

`OrderFactsPort` exists solely so `NotificationDispatchService` (application
layer) never imports the module's own `NOTIFICATIONS_PRISMA_CLIENT`
(infrastructure layer) directly — `arch:check`'s
`layer-application-no-outer` rule caught this during the build; the fix was
the usual one, a domain port + infrastructure adapter, not an exception.

## 4. Personal-data access model (D1)

Every `/v1/notifications/*` route is gated by `JwtAuthGuard` +
`RequireCapability({ feature: "notifications" })` — **no permission key**.
This is the caller's own inbox/preferences/subscriptions; a role-permission
gate would let one role block a teammate from muting their own push
notifications. The repository additionally scopes every query by the
caller's own `profileId` (never a path/query parameter) — there is no
cross-user read anywhere in this module.

## 5. Reused precedent (nothing invented)

- **Retry queue shape** — `shipping_webhook_events`/`WebhookRetryWorker`
  (EPIC-12 M12.4), applied to an outbound queue instead of inbound webhooks:
  same status machine, same backoff curve, same `FOR UPDATE SKIP LOCKED`
  claim, same widened cross-tenant RLS split.
- **Deferred external integration** — `CarrierPort`/`ManualCarrierAdapter`
  (EPIC-12/D1) → `CustomerMessagingPort`/`LoggingCustomerMessagingAdapter`
  (D5): the abstraction ships, only the real provider is deferred.
- **New stable dependency justification** — `pdfkit` (EPIC-13/D1) →
  `web-push` (D4): pure-JS, no native compile, MIT-licensed, the standard
  Node choice for the protocol.
- **Self-generated required secret** — `ENCRYPTION_KEY`/`PII_HASH_KEY`/
  `SHIPPING_WEBHOOK_SIGNING_SECRET` → `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`:
  required config, not optional third-party-key config, because VAPID key
  material is self-generated, never a vendor account credential.

## 6. Frontend (M15.4)

`NotificationBell` (`apps/web/src/components/shell/notification-bell.tsx`) —
shared by both shells' top bars (rendered inside `<FeatureGate feature="notifications">`).
No global "unread count": keyset pagination never exposes a total
(api-conventions §5), so the indicator is a boolean "has unread", polled via
a cheap `read=false&limit=1` request every 30s. The dropdown panel loads the
10 most recent notifications on open and marks read on click or via "mark
all read" (marks every currently-loaded unread id). `NotificationsPage`
(`pages/settings/notifications-page.tsx`, route `/settings/notifications`)
is the per-type/per-channel preferences screen. Out of scope for this pass:
an actual browser Web Push subscription flow (`navigator.serviceWorker` +
`pushManager.subscribe`) — that needs a service-worker asset, a frontend-build
concern the design doc explicitly deferred (§3); the `webPushEnabled` toggle
is real and wired end-to-end on the backend, it simply has no UI path yet to
register a device.
