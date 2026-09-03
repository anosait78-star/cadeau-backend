-- Drop the invitation's recipient email.
--
-- An invitation was addressed to one email and could only be accepted by a
-- signed-in user whose own address matched it exactly. That contradicted how
-- invitations are actually delivered here: the inviter copies the one-time
-- code and sends it themselves, and the invitee signs up with whatever
-- address they choose — so a correct code was rejected with a 403 whenever
-- the two addresses differed.
--
-- The code alone is now the credential, exactly as it already was for
-- warehouse join codes (`warehouse_join_codes`, Vendor Accounts Phase 1),
-- which have never been email-scoped. It stays bounded by the invitation's
-- 7-day expiry, its revocability, and its 32 bytes of entropy.
--
-- The column is dropped rather than made nullable: keeping a half-enforced
-- address invites a future reader to re-add the check for "the rows that have
-- one", which is the ambiguity this removes. Pending invitations keep working
-- — they are matched by code hash, which is untouched.
--
-- Destructive: recorded recipient addresses are not recoverable after this.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

DROP INDEX IF EXISTS public.invitations_email_idx;

ALTER TABLE public.invitations DROP COLUMN email;
