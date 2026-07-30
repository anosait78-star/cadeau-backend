import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { verifyJwt } from "@cadeau/crypto";
import { APP_CONFIG, type InjectedAppConfig } from "../config/config.tokens";
import { AppErrors } from "../errors/app-exception";
import { CLOCK, type Clock } from "../time/clock";
import type { AuthenticatedRequest, RequestPrincipal } from "./authenticated-request";
import { TOKEN_TYPE } from "./token-claims";

const BEARER = /^Bearer (.+)$/;

/**
 * Authenticates a request from its `Authorization: Bearer <access-token>` header.
 * The access token is a self-built HS256 JWT (`@cadeau/crypto`); the guard
 * verifies the signature, issuer, expiry, and that it is an *access* token, then
 * attaches the {@link RequestPrincipal} to the request for `@CurrentUser()`.
 *
 * The guard is stateless — it does not hit the database. Access tokens are
 * short-lived; revocation is enforced at refresh time (rotation + reuse
 * detection), the standard trade-off for stateless access tokens. Every failure
 * mode returns the same unified `401 UNAUTHORIZED`, leaking nothing about why.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: InjectedAppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.principal = this.authenticate(request.header("authorization"));
    return true;
  }

  private authenticate(authorization: string | undefined): RequestPrincipal {
    const match = authorization !== undefined ? BEARER.exec(authorization) : null;
    if (match === null) {
      throw AppErrors.unauthorized("Missing or malformed Authorization header.");
    }
    const token = match[1] as string;

    let claims: ReturnType<typeof verifyJwt>;
    try {
      claims = verifyJwt(token, this.config.jwt.accessSecret, {
        issuer: this.config.jwt.issuer,
        now: this.clock.now(),
      });
    } catch {
      throw AppErrors.unauthorized("Invalid or expired access token.");
    }

    if (claims["typ"] !== TOKEN_TYPE.access) {
      throw AppErrors.unauthorized("Invalid or expired access token.");
    }
    const sessionId = claims["sid"];
    const companyId = claims["cid"];
    if (typeof claims.sub !== "string" || typeof sessionId !== "string") {
      throw AppErrors.unauthorized("Invalid or expired access token.");
    }

    return {
      userId: claims.sub,
      sessionId,
      companyId: typeof companyId === "string" ? companyId : null,
    };
  }
}
