import type { Column } from "@/components/data-grid/types";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { Translate } from "@/components/i18n/translate-type";
import type { StockLevel } from "@/features/inventory/inventory-api";

/**
 * Stock levels' `Column<StockLevel>[]` defs for the generic DataGrid. Purely
 * presentational glue — adjust/transfer/reorder-point logic lives in
 * inventory-page.tsx.
 */
export function buildStockColumns({
  t,
  warehouseNames,
  variantNames,
}: {
  t: Translate;
  warehouseNames: ReadonlyMap<string, string>;
  variantNames: ReadonlyMap<string, string>;
}): Column<StockLevel>[] {
  return [
    {
      key: "variant",
      header: t("inventory.field.variant"),
      render: (row) => (
        <span className="font-medium">{variantNames.get(row.variantId) ?? row.variantId}</span>
      ),
    },
    {
      key: "warehouse",
      header: t("inventory.field.warehouse"),
      render: (row) => <span>{warehouseNames.get(row.warehouseId) ?? row.warehouseId}</span>,
    },
    {
      key: "onHand",
      header: t("inventory.stock.onHand"),
      render: (row) => <span className="tabular-nums">{row.onHand}</span>,
      align: "end",
    },
    {
      key: "committed",
      header: t("inventory.stock.committed"),
      render: (row) => <span className="tabular-nums">{row.committed}</span>,
      align: "end",
    },
    {
      key: "available",
      header: t("inventory.stock.available"),
      render: (row) => <span className="tabular-nums">{row.available}</span>,
      align: "end",
      clientSortable: true,
      sortAccessor: (row) => row.available,
    },
    {
      key: "reorderPoint",
      header: t("inventory.stock.reorderPoint"),
      render: (row) => {
        const low = row.reorderPoint > 0 && row.available <= row.reorderPoint;
        return (
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{row.reorderPoint}</span>
            {low ? (
              <StatusBadge tone="destructive" label={t("inventory.stock.low")} testId="low-badge" />
            ) : null}
          </span>
        );
      },
      align: "end",
    },
  ];
}
