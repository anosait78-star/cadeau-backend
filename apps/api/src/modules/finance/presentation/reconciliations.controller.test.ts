import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { ReconciliationView } from "../domain/finance.entity";
import { ReconciliationsController } from "./reconciliations.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function reconciliation(): ReconciliationView {
  return {
    id: "rec1",
    carrier: "manual",
    statementRef: "STMT-2026-01",
    periodKey: "2026-01",
    totalStatementMinor: 5000,
    totalFeeMinor: 4800,
    totalVarianceMinor: 200,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lines: [
      {
        id: "rl1",
        shipmentId: "ship1",
        statementAmountMinor: 5000,
        shipmentFeeMinor: 4800,
        varianceMinor: 200,
      },
    ],
  };
}

function page<T>(rows: T[]): KeysetPage<T> {
  return { data: rows, page: { limit: 25, nextCursor: "c1", hasMore: true } };
}

function makeResponse(): Response & {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

type ServiceMock = { [K in keyof FinanceService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
  return {
    listReconciliations: vi.fn().mockResolvedValue(page([reconciliation()])),
    getReconciliation: vi.fn().mockResolvedValue(reconciliation()),
    createReconciliation: vi.fn().mockResolvedValue(reconciliation()),
  } as unknown as ServiceMock;
}

describe("ReconciliationsController", () => {
  it("renders the keyset envelope for the list", async () => {
    const service = makeService();
    const controller = new ReconciliationsController(service as unknown as FinanceService);
    const result = await controller.list(principal, { carrier: "manual" });
    expect(service.listReconciliations).toHaveBeenCalledWith(principal, { carrier: "manual" });
    expect(result.data[0]).toMatchObject({ id: "rec1", carrier: "manual" });
  });

  it("renders the detail", async () => {
    const service = makeService();
    const controller = new ReconciliationsController(service as unknown as FinanceService);
    const dto = await controller.getOne(principal, "rec1");
    expect(service.getReconciliation).toHaveBeenCalledWith(principal, "rec1");
    expect(dto.lines).toHaveLength(1);
  });

  it("creates a reconciliation, forwarding the idempotency key, and sets Location", async () => {
    const service = makeService();
    const controller = new ReconciliationsController(service as unknown as FinanceService);
    const res = makeResponse();
    const body = {
      carrier: "manual",
      statementRef: "STMT-2026-01",
      periodKey: "2026-01",
      lines: [{ trackingNumber: "TRK1", statementAmountMinor: 5000 }],
    };
    const dto = await controller.create(principal, body, "key-1", res);
    expect(service.createReconciliation).toHaveBeenCalledWith(principal, {
      ...body,
      idempotencyKey: "key-1",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/finance/reconciliations/rec1");
    expect(dto.id).toBe("rec1");
  });

  it("creates a reconciliation without an idempotency key when the header is absent", async () => {
    const service = makeService();
    const controller = new ReconciliationsController(service as unknown as FinanceService);
    const body = {
      carrier: "manual",
      statementRef: "STMT-2026-01",
      periodKey: "2026-01",
      lines: [{ trackingNumber: "TRK1", statementAmountMinor: 5000 }],
    };
    await controller.create(principal, body, undefined, makeResponse());
    expect(service.createReconciliation).toHaveBeenCalledWith(principal, body);
  });
});
