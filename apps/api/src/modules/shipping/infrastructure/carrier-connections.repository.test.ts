import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { CarrierConnectionsRepository } from "./carrier-connections.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const DATE = new Date("2026-01-02T03:04:05.000Z");

function connectionRow(extra: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    carrier: "bosta",
    isActive: true,
    pickupLocationWarning: false,
    connectedAt: DATE,
    ...extra,
  };
}

function makeRepo() {
  const rows: Record<string, unknown>[] = [];
  const models = {
    carrierConnection: {
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.filter((r) => r["companyId"] === where["companyId"])),
      ),
      findFirst: vi.fn(
        ({
          where,
          select,
        }: {
          where: Record<string, unknown>;
          select?: Record<string, boolean>;
        }) => {
          const row = rows.find(
            (r) =>
              r["companyId"] === where["companyId"] &&
              r["carrier"] === where["carrier"] &&
              (where["isActive"] === undefined || r["isActive"] === where["isActive"]),
          );
          if (row === undefined) return Promise.resolve(null);
          if (select === undefined) return Promise.resolve(row);
          const projected: Record<string, unknown> = {};
          for (const key of Object.keys(select)) projected[key] = row[key];
          return Promise.resolve(projected);
        },
      ),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { companyId_carrier: { companyId: string; carrier: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = rows.find(
            (r) =>
              r["companyId"] === where.companyId_carrier.companyId &&
              r["carrier"] === where.companyId_carrier.carrier,
          );
          if (existing !== undefined) {
            Object.assign(existing, update);
            return Promise.resolve(existing);
          }
          const row = { companyId: where.companyId_carrier.companyId, ...create };
          rows.push(row);
          return Promise.resolve(row);
        },
      ),
      updateMany: vi.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const r of rows) {
            if (
              r["companyId"] === where["companyId"] &&
              r["carrier"] === where["carrier"] &&
              r["isActive"] === true
            ) {
              Object.assign(r, data);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r["id"] === where.id);
        if (row === undefined) throw new Error("not found");
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const repo = new CarrierConnectionsRepository(prisma as unknown as PrismaClient);
  return { repo, rows, queryRaw };
}

describe("CarrierConnectionsRepository", () => {
  it("upserts a new connection, then updates it on reconnect", async () => {
    const { repo, rows } = makeRepo();

    const created = await repo.upsert({
      companyId: COMPANY,
      carrier: "bosta",
      apiKeyEncrypted: "v1.enc",
      webhookTokenHash: "hash-1",
      pickupLocationWarning: true,
      actorId: ACTOR,
    });
    expect(created).toMatchObject({
      carrier: "bosta",
      connected: true,
      pickupLocationWarning: true,
    });
    expect(rows).toHaveLength(1);

    const updated = await repo.upsert({
      companyId: COMPANY,
      carrier: "bosta",
      apiKeyEncrypted: "v1.enc2",
      webhookTokenHash: "hash-2",
      pickupLocationWarning: false,
      actorId: ACTOR,
    });
    expect(updated.pickupLocationWarning).toBe(false);
    expect(rows).toHaveLength(1); // still one row, updated in place
  });

  it("lists connections without exposing the encrypted key or token hash", async () => {
    const { repo, rows } = makeRepo();
    rows.push({ companyId: COMPANY, ...connectionRow() });
    const list = await repo.list(COMPANY);
    expect(list).toEqual([
      {
        id: "conn-1",
        carrier: "bosta",
        connected: true,
        pickupLocationWarning: false,
        connectedAt: DATE.toISOString(),
      },
    ]);
    expect(list[0]).not.toHaveProperty("apiKeyEncrypted");
  });

  it("findActive returns the secret fields only for an active row", async () => {
    const { repo, rows } = makeRepo();
    rows.push({
      companyId: COMPANY,
      ...connectionRow(),
      apiKeyEncrypted: "v1.enc",
      webhookTokenHash: "hash-1",
    });
    expect(await repo.findActive(COMPANY, "bosta")).toEqual({
      apiKeyEncrypted: "v1.enc",
      webhookTokenHash: "hash-1",
    });
    expect(await repo.findActive(COMPANY, "unknown")).toBeNull();
  });

  it("deactivate flips is_active and is idempotent", async () => {
    const { repo, rows } = makeRepo();
    rows.push({ companyId: COMPANY, ...connectionRow() });

    expect(await repo.deactivate(COMPANY, "bosta", ACTOR)).toBe("conn-1");
    expect(rows[0]?.["isActive"]).toBe(false);
    expect(await repo.deactivate(COMPANY, "bosta", ACTOR)).toBeNull();
  });
});
