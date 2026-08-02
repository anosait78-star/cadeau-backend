/**
 * Deterministic CSV import (settings > data import). Parses CSV text and maps
 * its columns onto product fields via an explicit **column mapping** — no
 * format guessing, no AI. Each data row becomes one product; when `sku` or
 * `barcode` is mapped it also becomes that product's first variant.
 *
 * Mirrors `orders/domain/csv-import.ts` (same reader, same mapping shape,
 * same per-row result contract) — kept as a module-local copy rather than a
 * shared import so the products and orders slices stay independently owned.
 */

/** Which CSV column feeds each product field. Values are header names. */
export interface ImportMapping {
  readonly name: string;
  readonly description?: string;
  readonly categoryId?: string;
  readonly unitId?: string;
  readonly sku?: string;
  readonly barcode?: string;
}

/** A single mapped row, ready to become a `CreateProductInput` (+ optional variant). */
export interface ImportRow {
  /** 1-based row number in the data (excludes the header), for per-row results. */
  readonly row: number;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string | null;
  readonly unitId: string | null;
  readonly sku: string | null;
  readonly barcode: string | null;
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

/** A mapped field names a CSV header column that doesn't exist in the file. */
export class MissingMappedColumnError extends Error {
  constructor(
    public readonly field: string,
    public readonly column: string,
  ) {
    super(`Mapped column "${column}" for field "${field}" was not found in the CSV header.`);
  }
}

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

/** Map parsed CSV against the mapping. The first row is the header. */
export function mapImport(matrix: string[][], mapping: ImportMapping): MappedImport {
  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  if (matrix.length < 2) return { rows, errors };
  if (matrix.length - 1 > IMPORT_MAX_ROWS) {
    throw new RangeError(`Import exceeds the ${IMPORT_MAX_ROWS}-row limit.`);
  }

  const header = matrix[0]!.map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const requireCol = (field: string, name: string): number => {
    const index = col(name);
    if (index < 0) throw new MissingMappedColumnError(field, name);
    return index;
  };
  const optionalCol = (field: string, name: string | undefined): number => {
    if (name === undefined) return -1;
    return requireCol(field, name);
  };

  const cName = requireCol("name", mapping.name);
  const cDesc = optionalCol("description", mapping.description);
  const cCategory = optionalCol("categoryId", mapping.categoryId);
  const cUnit = optionalCol("unitId", mapping.unitId);
  const cSku = optionalCol("sku", mapping.sku);
  const cBarcode = optionalCol("barcode", mapping.barcode);

  const cell = (cells: string[], index: number): string | null => {
    if (index < 0) return null;
    const value = (cells[index] ?? "").trim();
    return value.length > 0 ? value : null;
  };

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]!;
    const rowNo = r; // 1-based over the data rows
    const name = cell(cells, cName);

    if (name === null) {
      errors.push({ row: rowNo, message: "Missing name." });
      continue;
    }
    rows.push({
      row: rowNo,
      name,
      description: cell(cells, cDesc),
      categoryId: cell(cells, cCategory),
      unitId: cell(cells, cUnit),
      sku: cell(cells, cSku),
      barcode: cell(cells, cBarcode),
    });
  }
  return { rows, errors };
}
