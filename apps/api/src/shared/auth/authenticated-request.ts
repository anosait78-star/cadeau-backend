import type { Request } from "express";

/** The authenticated principal attached to a request by {@link JwtAuthGuard}. */
export interface RequestPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly companyId: string | null;
}

/** An Express request after the guard has attached a verified principal. */
export interface AuthenticatedRequest extends Request {
  principal?: RequestPrincipal;
}
