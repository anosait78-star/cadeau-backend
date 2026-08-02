import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import type { InvoiceListItem } from "@/features/finance/finance-api";
import { DASH, formatDate, formatMoney } from "./finance-shared";

/**
 * Invoices' `Column<InvoiceListItem>[]` defs for the generic DataGrid.
 * Purely presentational glue — issue/download logic lives in invoices-tab.tsx.
 */
export function buildInvoiceColumns({
  t,
  locale,
}: {
  t: Translate;
  locale: string;
}): Column<InvoiceListItem>[] {
  return [
    {
      key: "number",
      header: t("finance.invoices.field.number"),
      render: (row) => <span className="font-medium">#{row.number}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.number,
    },
    {
      key: "totalMinor",
      header: t("finance.invoices.field.total"),
      render: (row) => <span className="tabular-nums">{formatMoney(row.totalMinor, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.totalMinor,
    },
    {
      key: "subtotalMinor",
      header: t("finance.invoices.field.subtotal"),
      render: (row) => (
        <span className="tabular-nums">{formatMoney(row.subtotalMinor, locale)}</span>
      ),
      clientSortable: true,
      sortAccessor: (row) => row.subtotalMinor,
    },
    {
      key: "vatMinor",
      header: t("finance.invoices.field.vat"),
      render: (row) => <span className="tabular-nums">{formatMoney(row.vatMinor, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.vatMinor,
    },
    {
      key: "orderId",
      header: t("finance.invoices.field.order"),
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
