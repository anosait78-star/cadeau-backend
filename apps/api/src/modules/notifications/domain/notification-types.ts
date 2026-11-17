/**
 * The closed set of notification types this epic produces (EPIC-15, decision
 * D6) — one per event-bus subscription. `notifications.type_check` in the
 * M15.1 migration enforces the same list at the database.
 */
export const NOTIFICATION_TYPES = [
  /**
   * A new order landed in the company. Sent on `order.created` to the people
   * who are expected to act on a fresh order (assignee if any, otherwise the
   * `orders.manage` holders) — see `NotificationDispatchService`.
   */
  "order.created",
  "order.status_changed",
  "payment.collected",
  /**
   * Vendor Accounts, Phase 5: sent to a vendor's own account when the Parent
   * Order they have items in enters "processing" — one per vendor, carrying
   * only that vendor's own ids, never the full order or other vendors' data.
   */
  "order_vendor_group.assigned",
  /**
   * A message landed in a vendor conversation (EPIC-17 M17.5). Sent on
   * `message.created` to the other side of that one thread — every
   * `messaging.manage` holder when a vendor wrote, or the thread's vendor
   * when staff wrote. The sender is always excluded.
   */
  "message.received",
  /**
   * Vendor payouts (2026-11-17). `requested` and `cancelled` go to the
   * vendor's own account(s); `confirmed` goes to the `vendor_payouts.manage`
   * holders when the vendor confirmed, or to the vendor when a manager
   * confirmed on their behalf.
   */
  "vendor_payout.requested",
  "vendor_payout.confirmed",
  "vendor_payout.cancelled",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}
