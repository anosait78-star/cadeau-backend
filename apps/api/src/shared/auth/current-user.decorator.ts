import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { AppErrors } from "../errors/app-exception";
import type { AuthenticatedRequest, RequestPrincipal } from "./authenticated-request";

/**
 * Injects the authenticated {@link RequestPrincipal} into a handler parameter.
 * Must be used on a route protected by {@link JwtAuthGuard} (which populates it);
 * if the principal is absent — the guard was forgotten — it fails closed with a
 * `401` rather than handing the handler an undefined user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw AppErrors.unauthorized();
    }
    return request.principal;
  },
);
