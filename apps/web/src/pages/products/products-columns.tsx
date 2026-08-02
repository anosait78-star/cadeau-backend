import type { Column } from "@/components/data-grid/types";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { Product } from "@/features/products/products-api";
import type { Translate } from "@/components/i18n/translate-type";

const DASH = "—";

/**
 * Products' `Column<Product>[]` defs for the generic DataGrid. Purely
 * presentational glue — create/edit/archive logic lives in products-page.tsx.
 */
export function buildProductColumns({
  t,
  categoryNames,
  unitNames,
}: {
  t: Translate;
  categoryNames: ReadonlyMap<string, string>;
  unitNames: ReadonlyMap<string, string>;
}): Column<Product>[] {
  return [
    {
      key: "name",
      header: t("products.field.name"),
      render: (row) => <span className="font-medium">{row.name}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.name,
    },
    {
      key: "category",
      header: t("products.field.category"),
      render: (row) => <span>{(row.categoryId && categoryNames.get(row.categoryId)) || DASH}</span>,
    },
    {
      key: "unit",
      header: t("products.field.unit"),
      render: (row) => <span>{(row.unitId && unitNames.get(row.unitId)) || DASH}</span>,
    },
    {
      key: "status",
      header: t("products.status.title"),
      render: (row) => (
        <StatusBadge
          tone={row.active ? "success" : "neutral"}
          label={row.active ? t("products.status.active") : t("products.status.inactive")}
        />
      ),
    },
  ];
}
