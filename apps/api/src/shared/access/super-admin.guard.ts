import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { AppErrors } from "../errors/app-exception";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import {
  PLATFORM_ADMIN_REPOSITORY,
  type PlatformAdminRepositoryPort,
} from "./access-repository.port";

/**
 * Guards the platform Super-Admin surface (`/v1/admin`). Authorizes on the
 * `platform_admins` grant looked up by the caller's user id — a platform-level
 * privilege isolated from tenant roles and never carried in a tenant token.
 * Runs after `JwtAuthGuard`; a non-admin (or missing principal) is `403`.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdmins: PlatformAdminRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw AppErrors.unauthorized();
    }
    if (!(await this.platformAdmins.isPlatformAdmin(request.principal.userId))) {
      throw AppErrors.forbidden("Platform administrator access required.");
    }
    return true;
  }
}
