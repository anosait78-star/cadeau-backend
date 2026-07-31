import PDFDocument from "pdfkit";
import type { InvoicePdfData } from "../domain/finance.entity";

/** Render one integer minor-units amount as a plain decimal string (no currency symbol, no locale). */
function formatMinor(amountMinor: number): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

/**
 * Render a single-page-ish official VAT invoice as a real PDF (EPIC-13, D1).
 * Pure function of {@link InvoicePdfData}: no DB access, so it is
 * unit-testable in isolation (cheap check: a non-empty `Buffer` starting
 * with the `%PDF` magic bytes).
 */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (error: Error) => reject(error));

    const { invoice } = data;

    doc.fontSize(20).text(data.companyName ?? "Invoice", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(14).text(`Invoice #${invoice.number}`);
    doc.fontSize(10).fillColor("#444444");
    doc.text(`Date: ${invoice.createdAt}`);
    if (data.vatRegistrationNumber !== null) {
      doc.text(`VAT Registration No.: ${data.vatRegistrationNumber}`);
    }
    doc.fillColor("#000000");
    doc.moveDown(1);

    if (data.billToName !== null) {
      doc.fontSize(12).text("Bill To:");
      doc.fontSize(10).text(data.billToName);
      doc.moveDown(1);
    }

    // Line-items table.
    const tableTop = doc.y;
    const columns = { description: 50, quantity: 300, unitPrice: 370, lineTotal: 460 };
    doc.fontSize(10).fillColor("#000000");
    doc.text("Description", columns.description, tableTop);
    doc.text("Qty", columns.quantity, tableTop);
    doc.text("Unit Price", columns.unitPrice, tableTop);
    doc.text("Line Total", columns.lineTotal, tableTop);
    doc
      .moveTo(50, tableTop + 15)
      .lineTo(545, tableTop + 15)
      .stroke();

    let y = tableTop + 22;
    for (const line of invoice.lines) {
      doc.text(line.description, columns.description, y, { width: 240 });
      doc.text(String(line.quantity), columns.quantity, y);
      doc.text(formatMinor(line.unitPriceMinor), columns.unitPrice, y);
      doc.text(formatMinor(line.lineTotalMinor), columns.lineTotal, y);
      y += 18;
    }

    doc
      .moveTo(50, y + 4)
      .lineTo(545, y + 4)
      .stroke();
    y += 14;

    doc.text(`Subtotal: ${formatMinor(invoice.subtotalMinor)}`, columns.unitPrice, y);
    y += 16;
    doc.text(
      `VAT (${(invoice.vatRateBpsSnapshot / 100).toFixed(2)}%): ${formatMinor(invoice.vatMinor)}`,
      columns.unitPrice,
      y,
    );
    y += 16;
    doc.fontSize(12).text(`Total: ${formatMinor(invoice.totalMinor)}`, columns.unitPrice, y);

    doc.end();
  });
}
