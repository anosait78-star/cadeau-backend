-- Settings > Security: "request account deletion" (EPIC-15 settings follow-up).
--
-- A request only flags the account for review; it does not itself erase any
-- data. Nullable, no backfill needed for existing rows.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.profiles
  ADD COLUMN deletion_requested_at timestamptz NULL;
