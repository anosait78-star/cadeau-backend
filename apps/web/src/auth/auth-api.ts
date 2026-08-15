import { apiFetch } from "@/lib/api-client";

/** A token pair as returned by the BFF (auth + refresh + tenant-switch responses). */
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
}

/** Non-sensitive user summary embedded in an auth response. */
export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
}

/** The full authentication response: token pair + user summary. */
export interface AuthResponse extends TokenPair {
  readonly user: UserSummary;
}

/** A company the caller belongs to, with their membership role/status. */
export interface MembershipCompany {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly role: string;
  readonly status: string;
  /** Dialing prefix prepended to phone numbers for WhatsApp (settings tab). */
  readonly whatsappCountryCode: string | null;
}

/** The caller's profile plus the companies they belong to (`GET /v1/me`). */
export interface MeView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly twoFactorEnabled: boolean;
  readonly activeCompanyId: string | null;
  readonly companies: MembershipCompany[];
}

export interface LoginInput {
  email: string;
  password: string;
  totpCode?: string | undefined;
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName?: string | undefined;
  phone?: string | undefined;
}

/** `POST /v1/auth/login` — throws `ApiError` (`twoFactorRequired`) on a 2FA challenge. */
export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/login", { method: "POST", body: input, auth: false });
}

/** `POST /v1/auth/register` — create an account and open a session. */
export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/register", { method: "POST", body: input, auth: false });
}

/** `POST /v1/auth/logout` — revoke the current session (best-effort). */
export function logout(): Promise<void> {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}

/** `GET /v1/me` — the caller's profile + companies + active tenant. */
export function getMe(): Promise<MeView> {
  return apiFetch<MeView>("/me");
}

/** `POST /v1/companies/{id}/switch` — re-issue a token pair scoped to a company. */
export function switchCompany(companyId: string): Promise<TokenPair> {
  return apiFetch<TokenPair>(`/companies/${companyId}/switch`, { method: "POST" });
}

/** Monthly-orders-volume buckets offered on the create-company screen. */
export const MONTHLY_ORDERS_RANGES = [
  "under_100",
  "100_500",
  "500_1000",
  "1000_2000",
  "2000_5000",
  "over_5000",
] as const;

export type MonthlyOrdersRange = (typeof MONTHLY_ORDERS_RANGES)[number];

/** `POST /v1/companies` payload. */
export interface CreateCompanyInput {
  name: string;
  slug?: string | undefined;
  phone: string;
  monthlyOrdersRange: MonthlyOrdersRange;
  country?: string | undefined;
  facebookHandle?: string | undefined;
  instagramHandle?: string | undefined;
  websiteUrl?: string | undefined;
  shippingCarrier?: string | undefined;
}

/** A created (or fetched) company, including its onboarding profile fields. */
export interface CompanyRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly status: string;
  readonly phone: string | null;
  readonly monthlyOrdersRange: string | null;
  readonly country: string | null;
  readonly facebookHandle: string | null;
  readonly instagramHandle: string | null;
  readonly websiteUrl: string | null;
  readonly shippingCarrier: string | null;
  readonly whatsappCountryCode: string | null;
  readonly createdAt: string;
}

/** `POST /v1/companies` response: the new company plus tenant-scoped tokens. */
export interface CreateCompanyResponse {
  readonly company: CompanyRecord;
  readonly tokens: TokenPair;
}

/** `POST /v1/companies` — create a company and switch the session into it. */
export function createCompany(input: CreateCompanyInput): Promise<CreateCompanyResponse> {
  return apiFetch<CreateCompanyResponse>("/companies", { method: "POST", body: input });
}

/** Outcome of accepting an invitation by code. */
export interface AcceptInvitationResponse {
  readonly companyId: string;
  readonly role: string;
  readonly alreadyMember: boolean;
}

/** `POST /v1/invitations/accept` — join a company by its shareable invite code. */
export function acceptInvitation(code: string): Promise<AcceptInvitationResponse> {
  return apiFetch<AcceptInvitationResponse>("/invitations/accept", {
    method: "POST",
    body: { code },
  });
}

/** Outcome of accepting a warehouse join code (Vendor Accounts, Phase 1). */
export interface AcceptWarehouseJoinCodeResponse {
  readonly companyId: string;
  readonly role: string;
  readonly warehouseId: string | null;
  readonly alreadyMember: boolean;
}

/**
 * `POST /v1/warehouse-join-codes/accept` — join a company as a vendor, scoped
 * to one warehouse, by its shareable join code (Vendor Accounts, Phase 1).
 */
export function acceptWarehouseJoinCode(code: string): Promise<AcceptWarehouseJoinCodeResponse> {
  return apiFetch<AcceptWarehouseJoinCodeResponse>("/warehouse-join-codes/accept", {
    method: "POST",
    body: { code },
  });
}

/** `PATCH /v1/companies/{id}/whatsapp-settings` — set (or clear) the dialing prefix. */
export function updateWhatsappCountryCode(
  companyId: string,
  countryCode: string | null,
): Promise<CompanyRecord> {
  return apiFetch<CompanyRecord>(`/companies/${companyId}/whatsapp-settings`, {
    method: "PATCH",
    body: { countryCode },
  });
}

/** `POST /v1/auth/change-password` — the caller must present their current password. */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiFetch<void>("/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

/** `POST /v1/auth/account-deletion-request` — flags the account for review; does not erase data. */
export function requestAccountDeletion(): Promise<void> {
  return apiFetch<void>("/auth/account-deletion-request", { method: "POST" });
}
