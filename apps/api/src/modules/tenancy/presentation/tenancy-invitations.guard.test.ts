import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { AccessResolverService } from "../../../shared/access/access-resolver.service";
import { AccessGuard } from "../../../shared/access/access.guard";
import type { EffectiveCapabilities } from "../../../shared/access/capabilities";
import { TenancyController } from "./tenancy.controller";

/**
 * Proves that `access.manage` actually gates the two invitation-mutation
 * routes on the real controller — reads the real `@RequireCapability`
 * metadata off `TenancyController.prototype` (via a real `Reflector`, not a
 * stub), so this fails if the decorator is ever removed from either handler.
 */

const PRINCIPAL: RequestPrincipal = {
  userId: randomUUID(),
  sessionId: randomUUID(),
  companyId: "c1",
};

/** `handler` is only ever a controller method reference, used as an opaque metadata carrier for `Reflect.getMetadata`. */
function context(handler: unknown): ExecutionContext {
  const request = { principal: PRINCIPAL };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => TenancyController,
  } as unknown as ExecutionContext;
}

function resolverWith(caps: EffectiveCapabilities): AccessResolverService {
  return { resolve: vi.fn().mockResolvedValue(caps) } as unknown as AccessResolverService;
}

const NO_PERMISSIONS: EffectiveCapabilities = { features: [], permissions: [] };
const WITH_ACCESS_MANAGE: EffectiveCapabilities = { features: [], permissions: ["access.manage"] };

describe("TenancyController — invitation routes require access.manage", () => {
  const reflector = new Reflector();

  it("createInvitation: denies a member without access.manage", async () => {
    const guard = new AccessGuard(reflector, resolverWith(NO_PERMISSIONS));
    await expect(
      guard.canActivate(context(TenancyController.prototype.createInvitation)),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("createInvitation: allows a member with access.manage", async () => {
    const guard = new AccessGuard(reflector, resolverWith(WITH_ACCESS_MANAGE));
    await expect(
      guard.canActivate(context(TenancyController.prototype.createInvitation)),
    ).resolves.toBe(true);
  });

  it("revokeInvitation: denies a member without access.manage", async () => {
    const guard = new AccessGuard(reflector, resolverWith(NO_PERMISSIONS));
    await expect(
      guard.canActivate(context(TenancyController.prototype.revokeInvitation)),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("revokeInvitation: allows a member with access.manage", async () => {
    const guard = new AccessGuard(reflector, resolverWith(WITH_ACCESS_MANAGE));
    await expect(
      guard.canActivate(context(TenancyController.prototype.revokeInvitation)),
    ).resolves.toBe(true);
  });
});
