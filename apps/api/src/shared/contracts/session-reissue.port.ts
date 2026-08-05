import type { RequestPrincipal } from "../auth/authenticated-request";
import type { TokenPair } from "./token-pair";

/**
 * Shared cross-feature contract for re-issuing a session's tokens scoped to a
 * tenant. The auth feature implements it (rotating the current session's refresh
 * token and stamping the tenant into the new access token); the tenancy feature
 * consumes it on company create/switch. Features couple through this port rather
 * than importing each other (architecture rule `no-cross-feature-imports`).
 */
export interface SessionReissuePort {
  /**
   * Re-issue the caller's current session scoped to `companyId`. The caller's
   * right to that tenant (membership) is verified by the consumer before calling.
   */
  reissueForCompany(principal: RequestPrincipal, companyId: string): Promise<TokenPair>;
}

/** DI token for {@link SessionReissuePort}. */
export const SESSION_REISSUE = Symbol("SESSION_REISSUE");
