/**
 * The closed set of notification types this epic produces (EPIC-15, decision
 * D6) — one per event-bus subscription. `notifications.type_check` in the
 * M15.1 migration enforces the same list at the database.
 */
export const NOTIFICATION_TYPES = [
  "order.status_changed",
  "payment.collected",
  /**
   * Vendor Accounts, Phase 5: sent to a vendor's own account when the Parent
   * Order they have items in enters "processing" — one per vendor, carrying
   * only that vendor's own ids, never the full order or other vendors' data.
   */
  "order_vendor_group.assigned",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}
