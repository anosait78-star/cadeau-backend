-- Vendor Accounts — Phase 5 (vendor order notifications). Widens the two
-- closed-set CHECK constraints from EPIC-15 (notifications /
-- notification_preferences) to admit one new type:
--
--   'order_vendor_group.assigned' — sent to a vendor's own account when the
--   Parent Order they have items in enters "processing" (one notification
--   per vendor, carrying only that vendor's own ids — never the full order
--   or other vendors' data). Emitted by the existing `order.status_changed`
--   subscriber in NotificationDispatchService; no orders-module write path
--   changes.
--
-- Purely additive: existing rows/types are untouched, only a new value is
-- now allowed. No new table, no RLS change.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order.status_changed', 'payment.collected', 'order_vendor_group.assigned'
  ));

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT notification_preferences_type_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_type_check CHECK (type IN (
    'order.status_changed', 'payment.collected', 'order_vendor_group.assigned'
  ));
