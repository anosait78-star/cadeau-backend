/**
 * The invitation role vocabulary (Team/Invitations, EPIC-15) — shared between
 * the presentation-layer DTO (request shape validation) and the application
 * service (business validation), so both stay in lockstep with a single
 * source of truth.
 */

/** The fixed permission-template keys a member may be invited under (EPIC-5 catalog). */
export const TEMPLATE_ROLES = [
  "owner",
  "store_manager",
  "call_center",
  "warehouse",
  "finance",
  "marketing",
] as const;

/**
 * The Owner template key. Called out separately because inviting a new Owner
 * carries its own authorization rule (see {@link TenancyService.createInvitation}) —
 * the permission catalog has no dedicated "manage owners" capability (EPIC-5
 * ships only `access.read`/`access.manage`), so that rule is enforced against
 * the caller's own membership role instead of a permission key.
 */
export const OWNER_ROLE = "owner" as const;

/** Sentinel role for a one-off, hand-picked permission set (never a reusable role). */
export const CUSTOM_ROLE = "custom" as const;

/** Every role an invitation may carry. */
export const INVITABLE_ROLES = [...TEMPLATE_ROLES, CUSTOM_ROLE] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];
