/**
 * Cheap, real-output coverage for {@link renderInvoicePdf} (EPIC-13, M13.4,
 * D1): checks a non-empty `Buffer` starting with the `%PDF` magic bytes —
 * proof of real PDF output without a brittle byte-for-byte snapshot. Pure
 * function of {@link InvoicePdfData}: no DB access.
 */
import { describe, expect, it } from "vitest";
import type { InvoicePdfData } from "../domain/finance.entity";
import { renderInvoicePdf } from "./invoice-pdf.renderer";

function pdfData(extra: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    invoice: {
      id: "inv1",
      number: 42,
      orderId: "order1",
      subtotalMinor: 10000,
      vatMinor: 1400,
      totalMinor: 11400,
      vatRateBpsSnapshot: 1400,
      pdfGeneratedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lines: [
        {
          id: "l1",
          description: "Widget",
          quantity: 2,
          unitPriceMinor: 5000,
          lineTotalMinor: 10000,
        },
      ],
    },
    companyName: "Acme Trading",
    vatRegistrationNumber: "VAT-12345",
    billToName: "Jane Customer",
    ...extra,
  };
}

describe("renderInvoicePdf", () => {
  it("returns a non-empty Buffer starting with the %PDF magic bytes", async () => {
    const buffer = await renderInvoicePdf(pdfData());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders without a company name, VAT registration number, or bill-to (manual invoice)", async () => {
    const buffer = await renderInvoicePdf(
      pdfData({ companyName: null, vatRegistrationNumber: null, billToName: null }),
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a negative total (e.g. a heavily-refunded invoice) with a minus sign", async () => {
    const data = pdfData({
      invoice: {
        ...pdfData().invoice,
        subtotalMinor: -500,
        vatMinor: -70,
        totalMinor: -570,
      },
    });
    const buffer = await renderInvoicePdf(data);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders multiple line items", async () => {
    const data = pdfData({
      invoice: {
        ...pdfData().invoice,
        lines: [
          {
            id: "l1",
            description: "Widget A",
            quantity: 1,
            unitPriceMinor: 3000,
            lineTotalMinor: 3000,
          },
          {
            id: "l2",
            description: "Widget B",
            quantity: 3,
            unitPriceMinor: 2000,
            lineTotalMinor: 6000,
          },
        ],
      },
    });
    const buffer = await renderInvoicePdf(data);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
