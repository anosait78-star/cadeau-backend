import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { InvoicePdfData, InvoiceView } from "../domain/finance.entity";
import { InvoicesController } from "./invoices.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function invoice(extra: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: "inv1",
    number: 1,
    orderId: null,
    subtotalMinor: 10000,
    vatMinor: 1400,
    totalMinor: 11400,
    vatRateBpsSnapshot: 1400,
    pdfGeneratedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lines: [
      {
        id: "l1",
        description: "Widget",
        quantity: 1,
        unitPriceMinor: 10000,
        lineTotalMinor: 10000,
      },
    ],
    ...extra,
  };
}

function pdfData(): InvoicePdfData {
  return {
    invoice: invoice(),
    companyName: "Acme Trading",
    vatRegistrationNumber: "VAT-1",
    billToName: null,
  };
}

function page<T>(rows: T[]): KeysetPage<T> {
  return { data: rows, page: { limit: 25, nextCursor: "c1", hasMore: true } };
}

function makeResponse(): Response & {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const res = {
    status: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

type ServiceMock = { [K in keyof FinanceService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
  return {
    listInvoices: vi.fn().mockResolvedValue(page([invoice()])),
    getInvoice: vi.fn().mockResolvedValue(invoice()),
    createInvoice: vi.fn().mockResolvedValue(invoice()),
    getInvoicePdfData: vi.fn().mockResolvedValue(pdfData()),
    renderInvoicePdf: vi
      .fn()
      .mockResolvedValue({ buffer: Buffer.from("%PDF-fake"), invoiceNumber: "1" }),
  } as unknown as ServiceMock;
}

describe("InvoicesController", () => {
  it("renders the keyset envelope for the list", async () => {
    const service = makeService();
    const controller = new InvoicesController(service as unknown as FinanceService);
    const result = await controller.list(principal, { orderId: "order1" });
    expect(service.listInvoices).toHaveBeenCalledWith(principal, { orderId: "order1" });
    expect(result.data[0]).toMatchObject({ id: "inv1", number: 1 });
  });

  it("renders the detail with lines", async () => {
    const service = makeService();
    const controller = new InvoicesController(service as unknown as FinanceService);
    const dto = await controller.getOne(principal, "inv1");
    expect(service.getInvoice).toHaveBeenCalledWith(principal, "inv1");
    expect(dto.lines).toHaveLength(1);
  });

  it("issues an order-based invoice, forwarding the idempotency key, and sets Location", async () => {
    const service = makeService();
    const controller = new InvoicesController(service as unknown as FinanceService);
    const res = makeResponse();
    const dto = await controller.create(principal, { orderId: "order1" }, "key-1", res);
    expect(service.createInvoice).toHaveBeenCalledWith(principal, {
      orderId: "order1",
      idempotencyKey: "key-1",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/finance/invoices/inv1");
    expect(dto.id).toBe("inv1");
  });

  it("issues a manual-lines invoice without an idempotency key when the header is absent", async () => {
    const service = makeService();
    const controller = new InvoicesController(service as unknown as FinanceService);
    await controller.create(
      principal,
      { lines: [{ description: "Widget", quantity: 1, unitPriceMinor: 10000 }] },
      undefined,
      makeResponse(),
    );
    expect(service.createInvoice).toHaveBeenCalledWith(principal, {
      lines: [{ description: "Widget", quantity: 1, unitPriceMinor: 10000 }],
    });
  });

  it("streams a real PDF for the invoice", async () => {
    const service = makeService();
    const controller = new InvoicesController(service as unknown as FinanceService);
    const res = makeResponse();
    await controller.getPdf(principal, "inv1", res);
    expect(service.renderInvoicePdf).toHaveBeenCalledWith(principal, "inv1");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      expect.stringContaining("invoice-1.pdf"),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const sentBuffer = res.send.mock.calls[0]?.[0] as Buffer;
    expect(Buffer.isBuffer(sentBuffer)).toBe(true);
    expect(sentBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
