-- Team / Invitations (EPIC-15): a one-off "custom" role for an invitation, made
-- of hand-picked permission keys instead of a fixed PermissionTemplate. The set
-- belongs to that single invitation/member only — there is no reusable
-- CompanyRole table.
--
-- Backward-compatible: NOT NULL with a default of `{}`, so every existing
-- invitation row is filled in automatically and no existing data is touched.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.invitations
  ADD COLUMN custom_permission_keys text[] NOT NULL DEFAULT '{}';
