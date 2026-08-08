import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@cadeau/crypto";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { StorefrontAuditPort } from "../domain/storefront-audit.port";
import type { StorefrontConnectionsRepositoryPort } from "../domain/storefront-connections-repository.port";
import { DuplicateConnectionLabelError, WarehouseNotFoundError } from "../domain/storefront.errors";
import { StorefrontConnectionsService } from "./storefront-connections.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function connectionView(id: string) {
  return {
    id,
    label: "Main store",
    platform: "generic" as const,
    apiKeyPrefix: "sfk_abcd",
    defaultWarehouseId: null,
    status: "active" as const,
    lastEventAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeHarness() {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    rotateKey: vi.fn(),
    revoke: vi.fn(),
    findActiveByKeyPrefix: vi.fn(),
    touchLastEventAt: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new StorefrontConnectionsService(
    repo as unknown as StorefrontConnectionsRepositoryPort,
    audit as unknown as StorefrontAuditPort,
  );
  return { service, repo, audit };
}

describe("StorefrontConnectionsService", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("requires an active company", async () => {
    await expect(
      h.service.list(principal({ companyId: null }), undefined, undefined),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("create mints a high-entropy key, stores only its hash, and returns the plaintext once", async () => {
    h.repo.create.mockImplementation(async (_actor, data) => {
      expect(data.apiKeyHash).not.toBe(undefined);
      // The stored hash must verify against the plaintext returned to the caller.
      return { ...connectionView("c1"), _hash: data.apiKeyHash };
    });
    const result = await h.service.create(principal(), { label: "Main store" });
    expect(result.apiKey.startsWith("sfk_")).toBe(true);
    expect(result.apiKey.length).toBeGreaterThan(32);
    const [, createData] = h.repo.create.mock.calls[0] as [
      unknown,
      { apiKeyHash: string; apiKeyPrefix: string },
    ];
    expect(createData.apiKeyPrefix).toBe(result.apiKey.slice(0, 8));
    await expect(verifyPassword(result.apiKey, createData.apiKeyHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-key", createData.apiKeyHash)).resolves.toBe(false);
  });

  it("create audits the connection creation", async () => {
    h.repo.create.mockResolvedValue(connectionView("c1"));
    await h.service.create(principal(), { label: "Main store" });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storefront_connection.created", entityId: "c1" }),
    );
  });

  it("maps a duplicate label to 409", async () => {
    h.repo.create.mockRejectedValue(new DuplicateConnectionLabelError());
    await expect(h.service.create(principal(), { label: "Main store" })).rejects.toMatchObject({
      status: 409,
    });
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("maps an unknown default warehouse to 422", async () => {
    h.repo.create.mockRejectedValue(new WarehouseNotFoundError());
    await expect(
      h.service.create(principal(), { label: "Main store", defaultWarehouseId: "bad" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rotateKey mints a new key and returns it once; 404 if the connection is absent", async () => {
    h.repo.rotateKey.mockResolvedValueOnce(connectionView("c1"));
    const result = await h.service.rotateKey(principal(), "c1");
    expect(result.apiKey.startsWith("sfk_")).toBe(true);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storefront_connection.key_rotated" }),
    );

    h.repo.rotateKey.mockResolvedValueOnce(null);
    await expect(h.service.rotateKey(principal(), "missing")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("revoke marks a connection revoked and audits it; 404 if absent", async () => {
    h.repo.revoke.mockResolvedValueOnce({ ...connectionView("c1"), status: "revoked" as const });
    const result = await h.service.revoke(principal(), "c1");
    expect(result.status).toBe("revoked");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storefront_connection.revoked" }),
    );

    h.repo.revoke.mockResolvedValueOnce(null);
    await expect(h.service.revoke(principal(), "missing")).rejects.toMatchObject({ status: 404 });
  });

  it("getOne returns 404 for an absent connection", async () => {
    h.repo.findById.mockResolvedValueOnce(null);
    await expect(h.service.getOne(principal(), "missing")).rejects.toMatchObject({ status: 404 });
  });

  it("update delegates and audits; 404 if absent", async () => {
    h.repo.update.mockResolvedValueOnce(connectionView("c1"));
    await h.service.update(principal(), "c1", { label: "New label" });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storefront_connection.updated" }),
    );

    h.repo.update.mockResolvedValueOnce(null);
    await expect(h.service.update(principal(), "missing", {})).rejects.toMatchObject({
      status: 404,
    });
  });
});
