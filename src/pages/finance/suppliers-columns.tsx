import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { Supplier } from "@/features/finance/finance-api";
import { DASH } from "./finance-shared";

/**
 * Suppliers' `Column<Supplier>[]` defs for the generic DataGrid.
 * Purely presentational glue — create/edit/archive logic lives in
 * suppliers-tab.tsx.
 */
export function buildSupplierColumns({ t }: { t: Translate }): Column<Supplier>[] {
  return [
    {
      key: "name",
      header: t("finance.suppliers.field.name"),
      render: (row) => <span className="font-medium">{row.name}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.name,
    },
    {
      key: "phone",
      header: t("finance.suppliers.field.phone"),
      render: (row) => <span>{row.phone ?? DASH}</span>,
    },
    {
      key: "email",
      header: t("finance.suppliers.field.email"),
      render: (row) => <span>{row.email ?? DASH}</span>,
    },
    {
      key: "address",
      header: t("finance.suppliers.field.address"),
      render: (row) => <span>{row.address ?? DASH}</span>,
    },
    {
      key: "taxId",
      header: t("finance.suppliers.field.taxId"),
      render: (row) => <span>{row.taxId ?? DASH}</span>,
    },
    {
      key: "status",
      header: t("finance.status.active"),
      render: (row) => (
        <StatusBadge
          tone={row.active ? "success" : "neutral"}
          label={row.active ? t("finance.status.active") : t("finance.status.inactive")}
        />
      ),
    },
  ];
}
