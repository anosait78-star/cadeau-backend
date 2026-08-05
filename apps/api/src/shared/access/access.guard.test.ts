import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../auth/authenticated-request";
import { AppException } from "../errors/app-exception";
import type { AccessResolverService } from "./access-resolver.service";
import { AccessGuard } from "./access.guard";
import type { CapabilityRequirement, EffectiveCapabilities } from "./capabilities";
import { SuperAdminGuard } from "./super-admin.guard";
import type { PlatformAdminRepositoryPort } from "./access-repository.port";

const PRINCIPAL: RequestPrincipal = { userId: "u1", sessionId: "s1", companyId: "c1" };

/** A minimal ExecutionContext carrying a request and handler/class markers. */
function context(principal: RequestPrincipal | undefined): ExecutionContext {
  const request = { principal };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function reflectorWith(requirement: CapabilityRequirement | undefined): Reflector {
  return { getAllAndOverride: () => requirement } as unknown as Reflector;
}

function resolverWith(caps: EffectiveCapabilities): AccessResolverService {
  return { resolve: vi.fn().mockResolvedValue(caps) } as unknown as AccessResolverService;
}

describe("AccessGuard", () => {
  const caps: EffectiveCapabilities = { features: ["orders"], permissions: ["orders.read"] };

  it("passes through handlers with no requirement", async () => {
    const guard = new AccessGuard(reflectorWith(undefined), resolverWith(caps));
    await expect(guard.canActivate(context(PRINCIPAL))).resolves.toBe(true);
  });

  it("allows when the caller satisfies the requirement", async () => {
    const guard = new AccessGuard(
      reflectorWith({ feature: "orders", permission: "orders.read" }),
      resolverWith(caps),
    );
    await expect(guard.canActivate(context(PRINCIPAL))).resolves.toBe(true);
  });

  it("forbids (403) when a layer fails", async () => {
    const guard = new AccessGuard(
      reflectorWith({ permission: "orders.manage" }),
      resolverWith(caps),
    );
    await expect(guard.canActivate(context(PRINCIPAL))).rejects.toBeInstanceOf(AppException);
  });

  it("fails closed (401) when the principal is missing", async () => {
    const guard = new AccessGuard(reflectorWith({ feature: "orders" }), resolverWith(caps));
    await expect(guard.canActivate(context(undefined))).rejects.toBeInstanceOf(AppException);
  });
});

describe("SuperAdminGuard", () => {
  function guardWith(isAdmin: boolean): SuperAdminGuard {
    const repo: PlatformAdminRepositoryPort = {
      isPlatformAdmin: vi.fn().mockResolvedValue(isAdmin),
    };
    return new SuperAdminGuard(repo);
  }

  it("allows a platform admin", async () => {
    await expect(guardWith(true).canActivate(context(PRINCIPAL))).resolves.toBe(true);
  });

  it("forbids a non-admin", async () => {
    await expect(guardWith(false).canActivate(context(PRINCIPAL))).rejects.toBeInstanceOf(
      AppException,
    );
  });
});
