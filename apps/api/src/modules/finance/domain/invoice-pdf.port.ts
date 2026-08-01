import type { InvoicePdfData } from "./finance.entity";

/**
 * Port for rendering an invoice's official PDF (EPIC-13, D1). The application
 * layer depends on this interface, never on `pdfkit` or the concrete renderer
 * directly (dependencies point inward only — `layer-application-no-outer`).
 */
export interface InvoicePdfRendererPort {
  render(data: InvoicePdfData): Promise<Buffer>;
}

/** DI token for {@link InvoicePdfRendererPort}. */
export const INVOICE_PDF_RENDERER = Symbol("INVOICE_PDF_RENDERER");
