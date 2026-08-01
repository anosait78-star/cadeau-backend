/**
 * The closed set of notification types this epic produces (EPIC-15, decision
 * D6) — one per event-bus subscription. `notifications.type_check` in the
 * M15.1 migration enforces the same list at the database.
 */
export const NOTIFICATION_TYPES = ["order.status_changed", "payment.collected"] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}
