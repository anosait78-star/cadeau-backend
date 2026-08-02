import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import type { Expense } from "@/features/finance/finance-api";
import { DASH, formatDate, formatMoney } from "./finance-shared";

/**
 * Expenses' `Column<Expense>[]` defs for the generic DataGrid.
 * Purely presentational glue — create/edit logic lives in expenses-tab.tsx.
 */
export function buildExpenseColumns({
  t,
  locale,
  supplierNames,
}: {
  t: Translate;
  locale: string;
  supplierNames: Map<string, string>;
}): Column<Expense>[] {
  return [
    {
      key: "category",
      header: t("finance.expenses.field.category"),
      render: (row) => <span className="font-medium">{row.category}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.category,
    },
    {
      key: "amountMinor",
      header: t("finance.expenses.field.amount"),
      render: (row) => <span className="tabular-nums">{formatMoney(row.amountMinor, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.amountMinor,
    },
    {
      key: "incurredAt",
      header: t("finance.expenses.field.incurredAt"),
      render: (row) => <span>{formatDate(row.incurredAt, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.incurredAt,
    },
    {
      key: "supplier",
      header: t("finance.expenses.field.supplier"),
      render: (row) => (
        <span>
          {row.supplierId !== null ? (supplierNames.get(row.supplierId) ?? row.supplierId) : DASH}
        </span>
      ),
    },
    {
      key: "notes",
      header: t("finance.expenses.field.notes"),
      render: (row) => <span>{row.notes ?? DASH}</span>,
    },
  ];
}
