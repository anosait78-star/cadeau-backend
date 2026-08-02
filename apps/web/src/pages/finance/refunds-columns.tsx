import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import type { Refund } from "@/features/finance/finance-api";
import { DASH, formatDate, formatMoney } from "./finance-shared";

/**
 * Refunds' `Column<Refund>[]` defs for the generic DataGrid.
 * Purely presentational glue — creation logic lives in refunds-tab.tsx.
 */
export function buildRefundColumns({
  t,
  locale,
}: {
  t: Translate;
  locale: string;
}): Column<Refund>[] {
  return [
    {
      key: "amountMinor",
      header: t("finance.refunds.field.amount"),
      render: (row) => <span className="tabular-nums">{formatMoney(row.amountMinor, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.amountMinor,
    },
    {
      key: "reason",
      header: t("finance.refunds.field.reason"),
      render: (row) => <span>{row.reason}</span>,
    },
    {
      key: "invoiceId",
      header: t("finance.refunds.field.invoice"),
      render: (row) => <span>{row.invoiceId ?? DASH}</span>,
    },
    {
      key: "orderId",
      header: t("finance.refunds.field.order"),
      render: (row) => <span>{row.orderId ?? DASH}</span>,
    },
    {
      key: "createdAt",
      header: t("finance.expenses.field.incurredAt"),
      render: (row) => <span>{formatDate(row.createdAt, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.createdAt,
    },
  ];
}
