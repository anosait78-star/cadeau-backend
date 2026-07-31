import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { RefundView } from "../domain/finance.entity";
import { RefundsController } from "./refunds.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function refund(extra: Partial<RefundView> = {}): RefundView {
  return {
    id: "ref1",
    invoiceId: "inv1",
    orderId: null,
    amountMinor: 5000,
    reason: "Customer returned the item.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
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
    listRefunds: vi.fn().mockResolvedValue(page([refund()])),
    createRefund: vi.fn().mockResolvedValue(refund()),
  } as unknown as ServiceMock;
}

describe("RefundsController", () => {
  it("renders the keyset envelope for the list", async () => {
    const service = makeService();
    const controller = new RefundsController(service as unknown as FinanceService);
    const result = await controller.list(principal, { invoiceId: "inv1" });
    expect(service.listRefunds).toHaveBeenCalledWith(principal, { invoiceId: "inv1" });
    expect(result.data[0]).toMatchObject({ id: "ref1", amountMinor: 5000 });
  });

  it("issues a refund, forwarding the (mandatory) idempotency key, and sets Location", async () => {
    const service = makeService();
    const controller = new RefundsController(service as unknown as FinanceService);
    const res = makeResponse();
    const dto = await controller.create(
      principal,
      { invoiceId: "inv1", amountMinor: 5000, reason: "Customer returned the item." },
      "key-1",
      res,
    );
    expect(service.createRefund).toHaveBeenCalledWith(principal, {
      invoiceId: "inv1",
      amountMinor: 5000,
      reason: "Customer returned the item.",
      idempotencyKey: "key-1",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/finance/refunds/ref1");
    expect(dto.id).toBe("ref1");
  });

  it("forwards an undefined idempotency key when the header is absent (service rejects it)", async () => {
    const service = makeService();
    const controller = new RefundsController(service as unknown as FinanceService);
    await controller.create(
      principal,
      { invoiceId: "inv1", amountMinor: 5000, reason: "x" },
      undefined,
      makeResponse(),
    );
    expect(service.createRefund).toHaveBeenCalledWith(principal, {
      invoiceId: "inv1",
      amountMinor: 5000,
      reason: "x",
      idempotencyKey: undefined,
    });
  });
});
