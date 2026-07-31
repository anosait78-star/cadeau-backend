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
    expect(parseCsv('name,note\n"Ali, Sr.","he said ""hi"""')).toEqual([
      ["name", "note"],
      ["Ali, Sr.", 'he said "hi"'],
    ]);
  });

  it("handles a file without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

const mapping: ImportMapping = {
  customerId: "customer",
  variantId: "variant",
  quantity: "qty",
  price: "price",
  shippingFee: "ship",
};

describe("mapImport", () => {
  it("maps valid rows and reports invalid ones per row", () => {
    const matrix = [
      ["customer", "variant", "qty", "price", "ship"],
      ["c1", "v1", "2", "15000", "5000"],
      ["", "v2", "1", "1000", ""], // missing customer
      ["c3", "v3", "0", "1000", ""], // bad qty
      ["c4", "v4", "1", "-5", ""], // bad price
    ];
    const { rows, errors } = mapImport(matrix, mapping);
    expect(rows).toEqual([
      {
        row: 1,
        customerId: "c1",
        variantId: "v1",
        quantity: 2,
        price: 15000,
        shippingFee: 5000,
        discount: 0,
      },
    ]);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4]);
  });

  it("maps the optional shipping and discount columns", () => {
    const withDiscount: ImportMapping = { ...mapping, discount: "disc" };
    const matrix = [
      ["customer", "variant", "qty", "price", "ship", "disc"],
      ["c1", "v1", "1", "1000", "500", "200"],
      ["c2", "v2", "1", "1000", "", ""], // blank optional cells default to 0
    ];
    const { rows } = mapImport(matrix, withDiscount);
    expect(rows[0]).toMatchObject({ shippingFee: 500, discount: 200 });
    expect(rows[1]).toMatchObject({ shippingFee: 0, discount: 0 });
  });

  it("returns nothing for an empty or header-only file", () => {
    expect(mapImport([], mapping)).toEqual({ rows: [], errors: [] });
    expect(mapImport([["customer", "variant", "qty", "price"]], mapping)).toEqual({
      rows: [],
      errors: [],
    });
  });
});
