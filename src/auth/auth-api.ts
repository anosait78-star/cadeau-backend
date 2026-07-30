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
