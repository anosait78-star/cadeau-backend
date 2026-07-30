import { apiFetch } from "@/lib/api-client";

/** The caller's resolved capabilities (`GET /v1/access/capabilities`). */
export interface Capabilities {
  readonly features: string[];
  readonly permissions: string[];
  readonly isSuperAdmin: boolean;
  readonly activeCompanyId: string | null;
}

/** A feature in the catalog, annotated with whether it is enabled for the company. */
export interface FeatureView {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly enabled: boolean;
}

/** A permission template (role preset) with its granted permission keys. */
export interface PermissionTemplateView {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: string[];
}

/** `GET /v1/access/capabilities` — the caller's effective capabilities (cached server-side). */
export function getCapabilities(): Promise<Capabilities> {
  return apiFetch<Capabilities>("/access/capabilities");
}

/** `GET /v1/access/features` — the feature catalog annotated for the active company. */
export function getFeatures(): Promise<{ data: FeatureView[] }> {
  return apiFetch<{ data: FeatureView[] }>("/access/features");
}

/** `GET /v1/access/permission-templates` — the role templates. */
export function getPermissionTemplates(): Promise<{ data: PermissionTemplateView[] }> {
  return apiFetch<{ data: PermissionTemplateView[] }>("/access/permission-templates");
}

/** One per-member permission override. */
export interface MemberPermissionOverride {
  readonly key: string;
  readonly granted: boolean;
}

/** `PUT /v1/access/members/{id}/permissions` — assign a template and/or overrides. */
export function assignMemberPermissions(
  memberId: string,
  input: { templateKey?: string; permissions?: MemberPermissionOverride[] },
): Promise<{ role: string; overrides: MemberPermissionOverride[] }> {
  return apiFetch(`/access/members/${memberId}/permissions`, { method: "PUT", body: input });
}
