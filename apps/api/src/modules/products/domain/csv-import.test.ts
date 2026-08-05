import { describe, expect, it } from "vitest";
import { mapImport, parseCsv, type ImportMapping } from "./csv-import";

describe("parseCsv", () => {
  it("parses a simple grid and skips blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("honours quoted fields with embedded commas and doubled quotes", () => {
    expect(parseCsv('name,note\n"Mug, Classic","he said ""hi"""')).toEqual([
      ["name", "note"],
      ["Mug, Classic", 'he said "hi"'],
    ]);
  });
});

const mapping: ImportMapping = {
  name: "name",
  description: "desc",
  sku: "sku",
};

describe("mapImport", () => {
  it("maps valid rows and reports rows missing the required name", () => {
    const matrix = [
      ["name", "desc", "sku"],
      ["Classic Mug", "A mug.", "MUG-1"],
      ["", "No name", "MUG-2"], // missing name
    ];
    const { rows, errors } = mapImport(matrix, mapping);
    expect(rows).toEqual([
      {
        row: 1,
        name: "Classic Mug",
        description: "A mug.",
        categoryId: null,
        unitId: null,
        sku: "MUG-1",
        barcode: null,
      },
    ]);
    expect(errors).toEqual([{ row: 2, message: "Missing name." }]);
  });

  it("maps optional category/unit/barcode columns when present", () => {
    const full: ImportMapping = {
      name: "name",
      categoryId: "cat",
      unitId: "unit",
      sku: "sku",
      barcode: "bar",
    };
    const matrix = [
      ["name", "cat", "unit", "sku", "bar"],
      ["Mug", "c1", "u1", "MUG-1", "12345"],
      ["Plain Mug", "", "", "", ""],
    ];
    const { rows } = mapImport(matrix, full);
    expect(rows[0]).toMatchObject({
      categoryId: "c1",
      unitId: "u1",
      sku: "MUG-1",
      barcode: "12345",
    });
    expect(rows[1]).toMatchObject({ categoryId: null, unitId: null, sku: null, barcode: null });
  });

  it("returns nothing for an empty or header-only file", () => {
    expect(mapImport([], mapping)).toEqual({ rows: [], errors: [] });
    expect(mapImport([["name", "desc", "sku"]], mapping)).toEqual({ rows: [], errors: [] });
  });
});
