import { createContext } from "react";
import type {
  AuthResponse,
  CreateCompanyInput,
  CreateCompanyResponse,
  LoginInput,
  MeView,
  RegisterInput,
} from "./auth-api";

/** Lifecycle of the session: unknown while hydrating, then a definite state. */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  readonly status: AuthStatus;
  /** The signed-in user + companies, or `null` when not authenticated. */
  readonly user: MeView | null;
  /** Exchange credentials for tokens and hydrate the session. */
  login: (input: LoginInput) => Promise<AuthResponse>;
  /** Create an account and hydrate the session. */
  register: (input: RegisterInput) => Promise<AuthResponse>;
  /** Revoke the session and clear tokens. */
  logout: () => Promise<void>;
  /** Switch the active tenant (re-issues tokens) and refresh the profile. */
  switchCompany: (companyId: string) => Promise<void>;
  /** Create a company, switch into it, and refresh the profile. */
  createCompany: (input: CreateCompanyInput) => Promise<CreateCompanyResponse>;
  /** Join a company by invite code, switch into it, and refresh the profile. */
  joinCompany: (code: string) => Promise<void>;
  /**
   * Join a company as a vendor by warehouse code, switch into it, and refresh
   * the profile (Vendor Accounts, Phase 1).
   */
  joinWarehouse: (code: string) => Promise<void>;
  /** Re-fetch `GET /v1/me` (e.g. after joining/creating a company). */
  reload: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
