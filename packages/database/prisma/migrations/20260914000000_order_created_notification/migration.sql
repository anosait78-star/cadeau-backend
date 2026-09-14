-- New-order notifications. Widens the two closed-set CHECK constraints from
-- EPIC-15 (notifications / notification_preferences) to admit one new type:
--
--   'order.created' — sent when an order is created, to the company's
--   owners, to every member effectively holding `orders.manage`, and to the
--   order's assignee when one was picked, as one de-duplicated set with the
--   actor excluded. Before this, creating an order produced no notification
--   at all: the dispatcher only subscribed to
--   `order.status_changed`/`payment.collected`, and both target
--   `orders.assignee_id`, which a fresh order almost never has.
--
-- Purely additive: existing rows/types are untouched, only a new value is now
-- allowed. No new table, no column, no RLS change.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order.created', 'order.status_changed', 'payment.collected',
    'order_vendor_group.assigned'
  ));

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT notification_preferences_type_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_type_check CHECK (type IN (
    'order.created', 'order.status_changed', 'payment.collected',
    'order_vendor_group.assigned'
  ));
