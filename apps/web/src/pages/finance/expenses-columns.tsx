import { CalendarDays } from "lucide-react";
import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import type { Expense } from "@/features/finance/finance-api";
import { CurrencyAmount, ExpenseCategoryChip } from "./expense-display";
import { DASH, formatDate } from "./finance-shared";

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
      render: (row) => <ExpenseCategoryChip category={row.category} />,
      clientSortable: true,
      sortAccessor: (row) => row.category,
    },
    {
      key: "amountMinor",
      header: t("finance.expenses.field.amount"),
      render: (row) => (
        <CurrencyAmount
          minor={row.amountMinor}
          locale={locale}
          unit={t("finance.expenses.currency")}
          className="font-semibold text-foreground"
        />
      ),
      clientSortable: true,
      sortAccessor: (row) => row.amountMinor,
    },
    {
      key: "incurredAt",
      header: t("finance.expenses.field.incurredAt"),
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {formatDate(row.incurredAt, locale)}
        </span>
      ),
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
      render: (row) => (
        <span className="line-clamp-1 text-muted-foreground">{row.notes ?? DASH}</span>
      ),
    },
  ];
}
