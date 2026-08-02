import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { PurchaseOrderListItem } from "@/features/finance/finance-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { DASH, formatDate } from "./finance-shared";

/**
 * Purchase orders' `Column<PurchaseOrderListItem>[]` defs for the generic
 * DataGrid. Purely presentational glue — create/receive/pay logic lives in
 * purchase-orders-tab.tsx.
 */
export function buildPurchaseOrderColumns({
  t,
  locale,
  supplierNames,
}: {
  t: Translate;
  locale: string;
  supplierNames: Map<string, string>;
}): Column<PurchaseOrderListItem>[] {
  return [
    {
      key: "number",
      header: t("finance.po.field.number"),
      render: (row) => <span className="font-medium">#{row.number}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.number,
    },
    {
      key: "supplier",
      header: t("finance.po.filter.supplier"),
      render: (row) => <span>{supplierNames.get(row.supplierId) ?? row.supplierId}</span>,
    },
    {
      key: "status",
      header: t("finance.po.filter.status"),
      render: (row) => (
        <StatusBadge label={t(`finance.po.status.${row.status}` as TranslationKey)} />
      ),
    },
    {
      key: "expectedDate",
      header: t("finance.po.field.expectedDate"),
      render: (row) => <span>{formatDate(row.expectedDate, locale)}</span>,
    },
    {
      key: "notes",
      header: t("finance.po.field.notes"),
      render: (row) => <span>{row.notes ?? DASH}</span>,
    },
  ];
}
