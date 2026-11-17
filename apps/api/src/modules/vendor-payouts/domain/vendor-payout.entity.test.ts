import { describe, expect, it } from "vitest";
import { isPayoutMethod, ledgerEntryStateOf, PAYOUT_METHODS } from "./vendor-payout.entity";

describe("ledgerEntryStateOf", () => {
  it("derives a ledger row's state from its payout", () => {
    expect(ledgerEntryStateOf(null)).toBe("open");
    expect(ledgerEntryStateOf("pending")).toBe("pending");
    expect(ledgerEntryStateOf("confirmed")).toBe("settled");
    // A cancelled payout's rows are unlinked; treat any straggler as owed again.
    expect(ledgerEntryStateOf("cancelled")).toBe("open");
  });
});

describe("isPayoutMethod", () => {
  it("accepts exactly the methods the database allows", () => {
    for (const method of PAYOUT_METHODS) expect(isPayoutMethod(method)).toBe(true);
    expect(isPayoutMethod("cheque")).toBe(false);
  });
});
