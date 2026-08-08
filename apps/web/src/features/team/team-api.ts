import { apiFetch } from "@/lib/api-client";

/** The fixed permission-template keys a member may be invited under (backend EPIC-5 catalog). */
export const TEMPLATE_ROLES = [
  "owner",
  "store_manager",
  "call_center",
  "warehouse",
  "finance",
  "marketing",
] as const;

/** Sentinel role for a one-off, hand-picked permission set (never a reusable role). */
export const CUSTOM_ROLE = "custom" as const;

export type TemplateRole = (typeof TEMPLATE_ROLES)[number];

/** A company member row for the Team page. */
export interface TeamMember {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly joinedAt: string;
}

/** An invitation row (no code — the code is only ever returned once, at creation). */
export interface TeamInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly permissionKeys: string[];
  readonly status: string;
  readonly expiresAt: string;
}

/** A freshly created invitation, including its one-time shareable code. */
export interface CreatedInvitation extends TeamInvitation {
  readonly code: string;
}

/** One permission the active company can grant right now (custom-role picker). */
export interface AvailablePermission {
  readonly key: string;
  readonly description: string | null;
  /** `null` for the two core, feature-independent permissions. */
  readonly featureKey: string | null;
}

/** `GET /v1/companies/{id}/members` — the company's active members. */
export function listMembers(companyId: string): Promise<{ data: TeamMember[] }> {
  return apiFetch(`/companies/${companyId}/members`);
}

/** `DELETE /v1/companies/{id}/members/{memberId}` — remove a member. */
export function removeMember(companyId: string, memberId: string): Promise<void> {
  return apiFetch(`/companies/${companyId}/members/${memberId}`, { method: "DELETE" });
}

/** `GET /v1/companies/{id}/invitations` — the company's invitations (any status), newest first. */
export function listInvitations(companyId: string): Promise<{ data: TeamInvitation[] }> {
  return apiFetch(`/companies/${companyId}/invitations`);
}

/**
 * `POST /v1/companies/{id}/invitations` — invite a member. `permissionKeys` is
 * only meaningful (and required, non-empty) when `role` is `"custom"`; the
 * server re-validates it against the company's actual available permissions
 * regardless of what is sent here.
 */
export function createInvitation(
  companyId: string,
  input: { email: string; role: string; permissionKeys?: string[] },
): Promise<CreatedInvitation> {
  return apiFetch(`/companies/${companyId}/invitations`, { method: "POST", body: input });
}

/** `DELETE /v1/companies/{id}/invitations/{invitationId}` — revoke a pending invitation. */
export function revokeInvitation(companyId: string, invitationId: string): Promise<void> {
  return apiFetch(`/companies/${companyId}/invitations/${invitationId}`, { method: "DELETE" });
}

/**
 * `GET /v1/access/available-permissions` — permissions the active company can
 * grant right now (its subscription plan + enabled feature flags), independent
 * of the caller's own role. Powers the custom-role permission picker; never a
 * substitute for the server-side validation `createInvitation` already does.
 */
export function listAvailablePermissions(): Promise<{ data: AvailablePermission[] }> {
  return apiFetch("/access/available-permissions");
}
