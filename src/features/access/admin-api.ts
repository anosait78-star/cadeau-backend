import { apiFetch } from "@/lib/api-client";

/** A company row on the Super-Admin surface (`GET /v1/admin/companies`). */
export interface AdminCompany {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly status: string;
  readonly planCode: string | null;
  readonly createdAt: string;
}

/** A keyset page of companies. */
export interface AdminCompaniesPage {
  readonly data: AdminCompany[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/** The seeded subscription plan codes a Super-Admin can assign. */
export const PLAN_CODES = ["free", "standard", "pro"] as const;

/** `GET /v1/admin/companies` — all companies, keyset-paginated. */
export function listCompanies(cursor?: string): Promise<AdminCompaniesPage> {
  const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  return apiFetch<AdminCompaniesPage>(`/admin/companies${query}`);
}

/** `PUT /v1/admin/companies/{id}/features/{key}` — toggle a feature for a company. */
export function toggleCompanyFeature(
  companyId: string,
  featureKey: string,
  enabled: boolean,
): Promise<{ featureKey: string; enabled: boolean }> {
  return apiFetch(`/admin/companies/${companyId}/features/${featureKey}`, {
    method: "PUT",
    body: { enabled },
  });
}

/** `PUT /v1/admin/companies/{id}/subscription` — set a company's plan. */
export function setCompanySubscription(
  companyId: string,
  planCode: string,
): Promise<{ planCode: string }> {
  return apiFetch(`/admin/companies/${companyId}/subscription`, {
    method: "PUT",
    body: { planCode },
  });
}
