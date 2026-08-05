import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { ExpenseView } from "../domain/finance.entity";
import { ExpensesController } from "./expenses.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function expense(): ExpenseView {
  return {
    id: "e1",
    category: "office_supplies",
    amountMinor: 12500,
    incurredAt: "2026-01-01T00:00:00.000Z",
    notes: null,
    supplierId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    listExpenses: vi.fn().mockResolvedValue(page([expense()])),
    getExpense: vi.fn().mockResolvedValue(expense()),
    createExpense: vi.fn().mockResolvedValue(expense()),
    updateExpense: vi.fn().mockResolvedValue(expense()),
  } as unknown as ServiceMock;
}

describe("ExpensesController", () => {
  it("renders the keyset envelope for the list", async () => {
    const service = makeService();
    const controller = new ExpensesController(service as unknown as FinanceService);
    const result = await controller.list(principal, { category: "travel" });
    expect(service.listExpenses).toHaveBeenCalledWith(principal, { category: "travel" });
    expect(result.data[0]).toMatchObject({ id: "e1", category: "office_supplies" });
  });

  it("renders the detail", async () => {
    const service = makeService();
    const controller = new ExpensesController(service as unknown as FinanceService);
    const dto = await controller.getOne(principal, "e1");
    expect(service.getExpense).toHaveBeenCalledWith(principal, "e1");
    expect(dto.id).toBe("e1");
  });

  it("creates an expense, forwarding the idempotency key, and sets Location", async () => {
    const service = makeService();
    const controller = new ExpensesController(service as unknown as FinanceService);
    const res = makeResponse();
    const dto = await controller.create(
      principal,
      { category: "office_supplies", amountMinor: 12500, incurredAt: "2026-01-01T00:00:00.000Z" },
      "key-1",
      res,
    );
    expect(service.createExpense).toHaveBeenCalledWith(principal, {
      category: "office_supplies",
      amountMinor: 12500,
      incurredAt: "2026-01-01T00:00:00.000Z",
      idempotencyKey: "key-1",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/finance/expenses/e1");
    expect(dto.id).toBe("e1");
  });

  it("creates an expense without an idempotency key when the header is absent", async () => {
    const service = makeService();
    const controller = new ExpensesController(service as unknown as FinanceService);
    await controller.create(
      principal,
      { category: "office_supplies", amountMinor: 12500, incurredAt: "2026-01-01T00:00:00.000Z" },
      undefined,
      makeResponse(),
    );
    expect(service.createExpense).toHaveBeenCalledWith(principal, {
      category: "office_supplies",
      amountMinor: 12500,
      incurredAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("updates an expense with the path id", async () => {
    const service = makeService();
    const controller = new ExpensesController(service as unknown as FinanceService);
    await controller.update(principal, "e1", { category: "travel" });
    expect(service.updateExpense).toHaveBeenCalledWith(principal, "e1", { category: "travel" });
  });
});
