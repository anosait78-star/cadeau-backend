# Notifications API Contract

**Status:** ⬜ Draft — planned in **EPIC-15** · **Base path:** `/v1/notifications` ·
**Feature key:** `NOTIFICATIONS` · **Access:** authenticated + gated

A notification center + Web Push, typed notifications (operational, proactive
rule-based, governance, financial), end-customer messaging (WhatsApp/SMS on status
change), fine-grained per-user preferences, and a reliable delivery queue. Draft —
follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Notification` — an in-app notification (type, payload, read state).
- `NotificationPreference` — per-user, per-type, per-channel settings.
- `PushSubscription` — a Web Push endpoint registration.

## Planned endpoints

| Method | Path                                        | Purpose                                   | Permission    |
| ------ | ------------------------------------------- | ----------------------------------------- | ------------- |
| GET    | `/v1/notifications`                         | List the caller's notifications (keyset). | authenticated |
| POST   | `/v1/notifications/read`                    | Mark one/many as read. Idempotency-Key.   | authenticated |
| GET    | `/v1/notifications/preferences`             | Get preferences.                          | authenticated |
| PUT    | `/v1/notifications/preferences`             | Update preferences.                       | authenticated |
| POST   | `/v1/notifications/push/subscriptions`      | Register a Web Push endpoint.             | authenticated |
| DELETE | `/v1/notifications/push/subscriptions/{id}` | Remove a push endpoint.                   | authenticated |

## List parameters

- Filter: `type`, `read`, `createdAtFrom/To`; sort (whitelist): `-createdAt,id` (default).

## Events emitted (ADR-004)

- `notification.created`, `notification.delivered`. Consumes domain events
  (`order.status_changed`, `payment.collected`, `stock.low`, …) to fan out.

## Notes

- Delivery uses a **reliable queue** with retries; channel selection honours the
  user's preferences.
- End-customer WhatsApp/SMS messaging is rate-limited and templated.
