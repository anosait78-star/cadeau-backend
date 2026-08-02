import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReconciliationListItem } from "@/features/finance/finance-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildReconciliationColumns } from "./reconciliations-columns";

const RECON: ReconciliationListItem = {
  id: "rc1",
  carrier: "Bosta",
  statementRef: "STMT-1",
  periodKey: "2026-01",
  totalStatementMinor: 100000,
  totalFeeMinor: 5000,
  totalVarianceMinor: 200,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildReconciliationColumns", () => {
  const columns = buildReconciliationColumns({ t, locale: "en" });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(RECON)}</div>);
    }
  });

  it("renders carrier, statementRef and periodKey", () => {
    render(<div>{columns.find((c) => c.key === "carrier")?.render(RECON)}</div>);
    expect(screen.getByText("Bosta")).toBeInTheDocument();
    render(<div>{columns.find((c) => c.key === "statementRef")?.render(RECON)}</div>);
    expect(screen.getByText("STMT-1")).toBeInTheDocument();
    render(<div>{columns.find((c) => c.key === "periodKey")?.render(RECON)}</div>);
    expect(screen.getByText("2026-01")).toBeInTheDocument();
  });

  it("marks the money columns client-sortable with numeric accessors", () => {
    for (const key of ["totalStatementMinor", "totalFeeMinor", "totalVarianceMinor"]) {
      const column = columns.find((c) => c.key === key);
      expect(column?.clientSortable).toBe(true);
      expect(typeof column?.sortAccessor?.(RECON)).toBe("number");
    }
  });
});
