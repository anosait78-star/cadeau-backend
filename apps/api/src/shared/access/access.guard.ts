import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppErrors } from "../errors/app-exception";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { AccessResolverService } from "./access-resolver.service";
import { can, type CapabilityRequirement } from "./capabilities";
import { REQUIRE_CAPABILITY_KEY } from "./require-capability.decorator";

/**
 * Enforces {@link RequireCapability} on annotated handlers via the central
 * Access Resolver. Runs after `JwtAuthGuard` (it needs the principal). A missing
 * feature OR permission — a failure of any of the three layers — is a uniform
 * `403 FORBIDDEN`. Unannotated handlers pass through.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: AccessResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<CapabilityRequirement | undefined>(
      REQUIRE_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requirement === undefined) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw AppErrors.unauthorized();
    }

    const caps = await this.resolver.resolve(request.principal);
    if (!can(caps, requirement)) {
      throw AppErrors.forbidden("You do not have access to this resource.");
    }
    return true;
  }
}
