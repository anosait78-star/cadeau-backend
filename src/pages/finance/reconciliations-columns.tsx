import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import type { ReconciliationListItem } from "@/features/finance/finance-api";
import { formatMoney } from "./finance-shared";

/**
 * Reconciliations' `Column<ReconciliationListItem>[]` defs for the generic DataGrid.
 * Purely presentational glue — matching/creation logic lives in reconciliations-tab.tsx.
 */
export function buildReconciliationColumns({
  t,
  locale,
}: {
  t: Translate;
  locale: string;
}): Column<ReconciliationListItem>[] {
  return [
    {
      key: "carrier",
      header: t("finance.reconciliations.field.carrier"),
      render: (row) => <span>{row.carrier}</span>,
    },
    {
      key: "statementRef",
      header: t("finance.reconciliations.field.statementRef"),
      render: (row) => <span>{row.statementRef}</span>,
    },
    {
      key: "periodKey",
      header: t("finance.reconciliations.field.periodKey"),
      render: (row) => <span>{row.periodKey}</span>,
    },
    {
      key: "totalStatementMinor",
      header: t("finance.reconciliations.field.statementAmount"),
      render: (row) => (
        <span className="tabular-nums">{formatMoney(row.totalStatementMinor, locale)}</span>
      ),
      clientSortable: true,
      sortAccessor: (row) => row.totalStatementMinor,
    },
    {
      key: "totalFeeMinor",
      header: t("shipping.field.fee"),
      render: (row) => (
        <span className="tabular-nums">{formatMoney(row.totalFeeMinor, locale)}</span>
      ),
      clientSortable: true,
      sortAccessor: (row) => row.totalFeeMinor,
    },
    {
      key: "totalVarianceMinor",
      header: t("finance.reconciliations.detail.variance"),
      render: (row) => (
        <span className="tabular-nums">{formatMoney(row.totalVarianceMinor, locale)}</span>
      ),
      clientSortable: true,
      sortAccessor: (row) => row.totalVarianceMinor,
    },
  ];
}
