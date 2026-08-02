import type { Column } from "@/components/data-grid/types";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { Translate } from "@/components/i18n/translate-type";
import type { Warehouse } from "@/features/inventory/inventory-api";

const DASH = "—";

/**
 * Warehouses' `Column<Warehouse>[]` defs for the generic DataGrid. Purely
 * presentational glue — create/edit/archive logic lives in inventory-page.tsx.
 */
export function buildWarehouseColumns({ t }: { t: Translate }): Column<Warehouse>[] {
  return [
    {
      key: "name",
      header: t("inventory.field.name"),
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {row.isDefault ? (
            <StatusBadge tone="info" label={t("inventory.field.isDefault")} />
          ) : null}
        </span>
      ),
      clientSortable: true,
      sortAccessor: (row) => row.name,
    },
    {
      key: "code",
      header: t("inventory.field.code"),
      render: (row) => <span>{row.code ?? DASH}</span>,
    },
    {
      key: "address",
      header: t("inventory.field.address"),
      render: (row) => <span>{row.address ?? DASH}</span>,
    },
    {
      key: "status",
      header: t("inventory.status.title"),
      render: (row) => (
        <StatusBadge
          tone={row.active ? "success" : "neutral"}
          label={row.active ? t("inventory.status.active") : t("inventory.status.inactive")}
        />
      ),
    },
  ];
}
