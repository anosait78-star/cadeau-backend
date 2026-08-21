import { createHmac } from "node:crypto";
import { type ExecutionContext } from "@nestjs/common";
import type { AppConfig } from "@cadeau/config";
import { encrypt, hashPassword } from "@cadeau/crypto";
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
const ENCRYPTION_KEY = "a".repeat(64); // 32 bytes hex, test-only
const CONFIG = { encryption: { key: ENCRYPTION_KEY } } as unknown as AppConfig;

function makeGuard(repo: Partial<StorefrontConnectionsRepositoryPort>): StorefrontApiKeyGuard {
  return new StorefrontApiKeyGuard(repo as StorefrontConnectionsRepositoryPort, CONFIG);
}

describe("StorefrontApiKeyGuard", () => {
  it("rejects a missing Authorization header", async () => {
    const repo = { findActiveByKeyPrefix: vi.fn() };
    const guard = makeGuard(repo);
    const req = { headers: {} } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
    expect(repo.findActiveByKeyPrefix).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization header", async () => {
    const repo = { findActiveByKeyPrefix: vi.fn() };
    const guard = makeGuard(repo);
    const req = { headers: { authorization: "Basic xyz" } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
  });

  it("rejects when no candidate's hash verifies (wrong API key)", async () => {
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([
        {
          connectionId: "c1",
          companyId: "co1",
          platform: "generic",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword("a-different-key"),
          webhookSecretEncrypted: null,
          actorId: "u1",
        },
      ]),
    };
    const guard = makeGuard(repo);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
    expect(repo.findActiveByKeyPrefix).toHaveBeenCalledWith(PREFIX);
  });

  it("rejects when no candidates share the prefix", async () => {
    const repo = { findActiveByKeyPrefix: vi.fn().mockResolvedValue([]) };
    const guard = makeGuard(repo);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
  });

  it("rejects a key that belongs to a different connection/company than the one targeted", async () => {
    // A verified key always resolves to ITS OWN connection/company — there is
    // no notion of "targeting" another one; this proves a right-key/wrong-row
    // candidate ahead of the true match is simply skipped, never matched.
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([
        {
          connectionId: "other-conn",
          companyId: "other-co",
          platform: "generic",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword("not-the-key"),
          webhookSecretEncrypted: null,
          actorId: "u1",
        },
      ]),
    };
    const guard = makeGuard(repo);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
    expect(req.storefrontConnection).toBeUndefined();
  });

  it("attaches the resolved connection and returns true on a verified key", async () => {
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([
        {
          connectionId: "c1",
          companyId: "co1",
          platform: "generic",
          defaultWarehouseId: "w1",
          apiKeyHash: await hashPassword(KEY),
          webhookSecretEncrypted: null,
          actorId: "u1",
        },
      ]),
    };
    const guard = makeGuard(repo);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.storefrontConnection).toEqual({
      connectionId: "c1",
      companyId: "co1",
      platform: "generic",
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
          platform: "generic",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword("nope"),
          webhookSecretEncrypted: null,
          actorId: "u1",
        },
        {
          connectionId: "right",
          companyId: "co-right",
          platform: "generic",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword(KEY),
          webhookSecretEncrypted: null,
          actorId: "u2",
        },
      ]),
    };
    const guard = makeGuard(repo);
    const req = { headers: { authorization: `Bearer ${KEY}` } } as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.storefrontConnection?.connectionId).toBe("right");
  });
});

describe("StorefrontApiKeyGuard — companyId in payload is never trusted", () => {
  it("resolves companyId from the connection alone; a companyId-shaped body field plays no role", async () => {
    // The guard never reads the request body at all — companyId can only
    // ever come from the resolved connection row (D3).
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([
        {
          connectionId: "c1",
          companyId: "real-co",
          platform: "generic",
          defaultWarehouseId: null,
          apiKeyHash: await hashPassword(KEY),
          webhookSecretEncrypted: null,
          actorId: "u1",
        },
      ]),
    };
    const guard = makeGuard(repo);
    const req = {
      headers: { authorization: `Bearer ${KEY}` },
      body: { companyId: "attacker-supplied-co" },
    } as unknown as StorefrontIngestionRequest;
    await guard.canActivate(makeContext(req));
    expect(req.storefrontConnection?.companyId).toBe("real-co");
  });
});

describe("StorefrontApiKeyGuard — WooCommerce webhook signature", () => {
  const secret = "wc-secret-123";

  function candidate(webhookSecretEncrypted: string | null) {
    return hashPassword(KEY).then((apiKeyHash) => ({
      connectionId: "c1",
      companyId: "co1",
      platform: "woocommerce" as const,
      defaultWarehouseId: null,
      apiKeyHash,
      webhookSecretEncrypted,
      actorId: "u1",
    }));
  }

  const ORDERS_PATH = "/v1/integrations/storefront/orders";

  it("skips signature verification when the connection has no secret configured", async () => {
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([await candidate(null)]),
    };
    const guard = makeGuard(repo);
    const req = {
      headers: { authorization: `Bearer ${KEY}` },
      rawBody: Buffer.from("{}"),
      path: ORDERS_PATH,
    } as unknown as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it("accepts a valid signature when a secret is configured", async () => {
    const encryptedSecret = encrypt(secret, ENCRYPTION_KEY);
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([await candidate(encryptedSecret)]),
    };
    const guard = makeGuard(repo);
    const rawBody = Buffer.from('{"id":123}');
    // Compute the signature the same way WooCommerce does.
    const validSignature = createHmac("sha256", secret).update(rawBody).digest("base64");
    const req = {
      headers: { authorization: `Bearer ${KEY}`, "x-wc-webhook-signature": validSignature },
      rawBody,
      path: ORDERS_PATH,
    } as unknown as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it("rejects a missing signature header when a secret is configured", async () => {
    const encryptedSecret = encrypt(secret, ENCRYPTION_KEY);
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([await candidate(encryptedSecret)]),
    };
    const guard = makeGuard(repo);
    const req = {
      headers: { authorization: `Bearer ${KEY}` },
      rawBody: Buffer.from('{"id":123}'),
      path: ORDERS_PATH,
    } as unknown as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
  });

  it("rejects an invalid signature when a secret is configured", async () => {
    const encryptedSecret = encrypt(secret, ENCRYPTION_KEY);
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([await candidate(encryptedSecret)]),
    };
    const guard = makeGuard(repo);
    const req = {
      headers: {
        authorization: `Bearer ${KEY}`,
        "x-wc-webhook-signature": "not-the-right-signature",
      },
      rawBody: Buffer.from('{"id":123}'),
      path: ORDERS_PATH,
    } as unknown as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
  });

  it("rejects when the raw body was not captured (misconfigured server)", async () => {
    const encryptedSecret = encrypt(secret, ENCRYPTION_KEY);
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([await candidate(encryptedSecret)]),
    };
    const guard = makeGuard(repo);
    const req = {
      headers: { authorization: `Bearer ${KEY}`, "x-wc-webhook-signature": "whatever" },
      path: ORDERS_PATH,
    } as unknown as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(AppException);
  });

  it("skips signature verification on the vendors route even with a matching secret configured", async () => {
    // .../vendors is never a native WooCommerce webhook delivery, so it can
    // never carry a WooCommerce-computed signature — the API key alone is
    // its full trust boundary (vendor auto-registration, 2026-08-21).
    const encryptedSecret = encrypt(secret, ENCRYPTION_KEY);
    const repo = {
      findActiveByKeyPrefix: vi.fn().mockResolvedValue([await candidate(encryptedSecret)]),
    };
    const guard = makeGuard(repo);
    const req = {
      headers: { authorization: `Bearer ${KEY}` },
      path: "/v1/integrations/storefront/vendors",
    } as unknown as StorefrontIngestionRequest;
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });
});
