import { describe, expect, it } from "vitest";
import {
  buildVendorAccruals,
  canEditOrderItems,
  effectiveWarehouseOf,
  vendorLedgerEffectOf,
  type AccruableLine,
} from "./vendor-ledger";

function line(extra: Partial<AccruableLine> = {}): AccruableLine {
  return {
    id: "i1",
    variantId: "v1",
    nameSnapshot: "Mug — Red",
    quantity: 2,
    warehouseId: "w-vendor",
    wholesaleCostMinor: 9000,
    ...extra,
  };
}

describe("vendorLedgerEffectOf", () => {
  it("accrues when the order itself enters delivered", () => {
    expect(vendorLedgerEffectOf("shipped", "delivered")).toBe("accrue");
  });

  it("reverses a return that happens after delivery", () => {
    expect(vendorLedgerEffectOf("delivered", "returned")).toBe("reverse");
    expect(vendorLedgerEffectOf("completed", "returned")).toBe("reverse");
  });

  it("owes and reverses nothing for a return before delivery", () => {
    expect(vendorLedgerEffectOf("shipped", "returned")).toBe("none");
  });

  it("leaves every other transition alone", () => {
    expect(vendorLedgerEffectOf("delivered", "completed")).toBe("none");
    expect(vendorLedgerEffectOf("delivered", "exchanged")).toBe("none");
    expect(vendorLedgerEffectOf("new", "processing")).toBe("none");
  });
});

describe("canEditOrderItems", () => {
  it("allows editing lines until the order is delivered", () => {
    expect(canEditOrderItems("new")).toBe(true);
    expect(canEditOrderItems("shipped")).toBe(true);
    expect(canEditOrderItems("cancelled")).toBe(true);
  });

  it("locks the lines from delivery on", () => {
    for (const status of ["delivered", "completed", "returned", "exchanged"] as const) {
      expect(canEditOrderItems(status)).toBe(false);
    }
  });
});

describe("effectiveWarehouseOf", () => {
  it("prefers the line's own routing, then the order's warehouse", () => {
    expect(effectiveWarehouseOf({ warehouseId: "w1" }, "w2")).toBe("w1");
    expect(effectiveWarehouseOf({ warehouseId: null }, "w2")).toBe("w2");
    expect(effectiveWarehouseOf({ warehouseId: null }, null)).toBeNull();
  });
});

describe("buildVendorAccruals", () => {
  const vendors = new Set(["w-vendor"]);

  it("accrues a vendor line at quantity × wholesale cost", () => {
    expect(buildVendorAccruals([line()], null, vendors)).toEqual([
      {
        warehouseId: "w-vendor",
        orderItemId: "i1",
        variantId: "v1",
        nameSnapshot: "Mug — Red",
        quantity: 2,
        unitCostMinor: 9000,
        amountMinor: 18000,
        needsPricing: false,
      },
    ]);
  });

  it("accrues an unpriced line at zero, flagged for pricing", () => {
    const [accrual] = buildVendorAccruals([line({ wholesaleCostMinor: null })], null, vendors);
    expect(accrual).toMatchObject({ unitCostMinor: 0, amountMinor: 0, needsPricing: true });
  });

  it("keeps a real zero price distinct from no price", () => {
    const [accrual] = buildVendorAccruals([line({ wholesaleCostMinor: 0 })], null, vendors);
    expect(accrual).toMatchObject({ amountMinor: 0, needsPricing: false });
  });

  it("uses the order's warehouse for a manual order's unrouted lines", () => {
    const accruals = buildVendorAccruals([line({ warehouseId: null })], "w-vendor", vendors);
    expect(accruals.map((a) => a.warehouseId)).toEqual(["w-vendor"]);
  });

  it("skips lines from the company's own warehouses and unrouted lines", () => {
    const accruals = buildVendorAccruals(
      [line({ id: "own", warehouseId: "w-own" }), line({ id: "none", warehouseId: null })],
      null,
      vendors,
    );
    expect(accruals).toEqual([]);
  });
});
