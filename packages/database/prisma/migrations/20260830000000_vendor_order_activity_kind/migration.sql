-- Vendor Accounts — Phase 6 (audit trail review). Widens the existing
-- order_activities_kind_check CHECK constraint (EPIC-11) to admit
-- 'vendor_status_changed' — appended to the Parent Order's own activity log
-- when a vendor advances their group's status, so the company can see the
-- history via the existing GET /orders/{id}/activity endpoint and
-- Activities/Timeline tabs, with no new read surface.
--
-- Purely additive: existing rows/kinds are untouched, only a new value is
-- now allowed. No new table, no change to Order.status or its transitions.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.order_activities
  DROP CONSTRAINT order_activities_kind_check;

ALTER TABLE public.order_activities
  ADD CONSTRAINT order_activities_kind_check CHECK (kind IN (
    'created','status_changed','assigned','edited','payment','item_added',
    'item_removed','follow_up_changed','merged','vendor_status_changed'
  ));
