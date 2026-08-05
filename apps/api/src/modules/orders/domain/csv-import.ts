/**
 * Deterministic CSV import (EPIC-11). Parses CSV text and maps its columns onto
 * order fields via an explicit **column mapping** — no format guessing, no AI.
 * Each data row becomes one single-line order (customer + one variant line);
 * richer multi-line imports are a later addition.
 *
 * The CSV reader handles quoted fields, embedded commas and doubled `""` escapes
 * — enough for the Excel/Sheets "Save as CSV" output sellers actually paste.
 */

/** Which CSV column feeds each order field. Values are header names. */
export interface ImportMapping {
  readonly customerId: string;
  readonly variantId: string;
  readonly quantity: string;
  readonly price: string;
  readonly shippingFee?: string;
  readonly discount?: string;
}

/** A single mapped row, ready to become a `CreateOrderInput`. */
export interface ImportRow {
  /** 1-based row number in the data (excludes the header), for per-row results. */
  readonly row: number;
  readonly customerId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly price: number;
  readonly shippingFee: number;
  readonly discount: number;
}

/** A row that could not be mapped (missing/invalid required cell). */
export interface ImportRowError {
  readonly row: number;
  readonly message: string;
}

/** The outcome of mapping the whole file. */
export interface MappedImport {
  readonly rows: ImportRow[];
  readonly errors: ImportRowError[];
}

/** The hard ceiling on one import — a single request may not stream unbounded. */
export const IMPORT_MAX_ROWS = 1000;

/** Parse CSV text into a matrix of string cells. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Flush the final field/row (files without a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim().length > 0)) rows.push(row);
  }
  return rows;
}

function toInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Map parsed CSV against the mapping. The first row is the header; each data row
 * yields either an {@link ImportRow} or an {@link ImportRowError}. Amounts are
 * integer minor units in the file already (the seller exports them that way);
 * quantities are whole units.
 */
export function mapImport(matrix: string[][], mapping: ImportMapping): MappedImport {
  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  if (matrix.length < 2) return { rows, errors };

  const header = matrix[0]!.map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const cCustomer = col(mapping.customerId);
  const cVariant = col(mapping.variantId);
  const cQty = col(mapping.quantity);
  const cPrice = col(mapping.price);
  const cShip = mapping.shippingFee !== undefined ? col(mapping.shippingFee) : -1;
  const cDisc = mapping.discount !== undefined ? col(mapping.discount) : -1;

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]!;
    const rowNo = r; // 1-based over the data rows
    const customerId = (cells[cCustomer] ?? "").trim();
    const variantId = (cells[cVariant] ?? "").trim();
    const quantity = toInt(cells[cQty]);
    const price = toInt(cells[cPrice]);

    if (customerId === "" || variantId === "") {
      errors.push({ row: rowNo, message: "Missing customerId or variantId." });
      continue;
    }
    if (quantity === null || quantity <= 0) {
      errors.push({ row: rowNo, message: "Quantity must be a positive whole number." });
      continue;
    }
    if (price === null || price < 0) {
      errors.push({ row: rowNo, message: "Price must be a non-negative integer (minor units)." });
      continue;
    }
    rows.push({
      row: rowNo,
      customerId,
      variantId,
      quantity,
      price,
      shippingFee: cShip >= 0 ? Math.max(0, toInt(cells[cShip]) ?? 0) : 0,
      discount: cDisc >= 0 ? Math.max(0, toInt(cells[cDisc]) ?? 0) : 0,
    });
  }
  return { rows, errors };
}
