import { type ExecutionContext } from "@nestjs/common";
import { hashPassword } from "@cadeau/crypto";
import { describe, expect, it, vi } from "vitest";
import { AppException } from "../../../shared/errors/app-exception";
import type { StorefrontConnectionsRepositoryPort } from "../domain/storefront-connections-repository.port";
import { StorefrontApiKeyGuard } from "./storefront-api-key.guard";
import type { StorefrontIngestionRequest } from "./storefront-api-key.guard";

function makeContext(req: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const KEY = "sfk_abcdefghijklmnopqrstuvwxyz0123456789";
const PREFIX = KEY.slice(0, 8);

describe("StorefrontApiKeyGuard", () => {
  it("rejects a missing Authorization header", async () => {
    const repo = { findActiveByKeyPrefix: vi.fn() };
    const guard = new StorefrontApiKeyGuard(repo as unknown as StorefrontConnectionsRepositoryPort);
    const req = { headers: {} } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
    expect(repo.findActiveByKeyPrefix).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization header", async () => {
    const repo = { findActiveByKeyPrefix: vi.fn() };
    const guard = new StorefrontApiKeyGuard(repo as unknown as StorefrontConnectionsRepositoryPort);
    const req = { headers: { authorization: "Basic xyz" } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
  });

  it("rejects when no candidate's hash verifies", async () => {
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([
        {
          connectionId: "c1",
          companyId: "co1",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword("a-different-key"),
          actorId: "u1",
        },
      ]),
    };
    const guard = new StorefrontApiKeyGuard(repo as unknown as StorefrontConnectionsRepositoryPort);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
    expect(repo.findActiveByKeyPrefix).toHaveBeenCalledWith(PREFIX);
  });

  it("rejects when no candidates share the prefix", async () => {
    const repo = { findActiveByKeyPrefix: vi.fn().mockResolvedValue([]) };
    const guard = new StorefrontApiKeyGuard(repo as unknown as StorefrontConnectionsRepositoryPort);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
  });

  it("attaches the resolved connection and returns true on a verified key", async () => {
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([
        {
          connectionId: "c1",
          companyId: "co1",
          defaultWarehouseId: "w1",
          apiKeyHash: await hashPassword(KEY),
          actorId: "u1",
        },
      ]),
    };
    const guard = new StorefrontApiKeyGuard(repo as unknown as StorefrontConnectionsRepositoryPort);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.storefrontConnection).toEqual({
      connectionId: "c1",
      companyId: "co1",
      defaultWarehouseId: "w1",
      actorId: "u1",
    });
  });

  it("verifies each candidate in turn when several share a prefix", async () => {
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([
        {
          connectionId: "wrong",
          companyId: "co-wrong",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword("nope"),
          actorId: "u1",
        },
        {
          connectionId: "right",
          companyId: "co-right",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword(KEY),
          actorId: "u2",
        },
      ]),
    };
    const guard = new StorefrontApiKeyGuard(repo as unknown as StorefrontConnectionsRepositoryPort);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.storefrontConnection?.connectionId).toBe("right");
  });
});
