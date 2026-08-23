import type { ReactNode } from "react";
import type { Column } from "@/components/data-grid/types";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { Translate } from "@/components/i18n/translate-type";
import type { StockLevel } from "@/features/inventory/inventory-api";

/**
 * Stock levels' `Column<StockLevel>[]` defs for the generic DataGrid. Purely
 * presentational glue — adjust/transfer/reorder-point logic lives in
 * inventory-page.tsx.
 *
 * Product name, variant, sku, and image all ride on the row itself, so nothing
 * here depends on a separately-fetched catalog. Only warehouse names still come
 * from a lookup map: the warehouse list is loaded in full for the filter
 * dropdown anyway, so the row need not repeat it.
 */
export function buildStockColumns({
  t,
  warehouseNames,
}: {
  t: Translate;
  warehouseNames: ReadonlyMap<string, string>;
}): Column<StockLevel>[] {
  return [
    {
      key: "image",
      header: t("inventory.field.image"),
      render: (row) => <ProductThumb imageUrl={row.imageUrl} size="sm" />,
      width: "4rem",
    },
    {
      key: "product",
      header: t("inventory.field.product"),
      render: (row) => <StockIdentity level={row} />,
      clientSortable: true,
      sortAccessor: (row) => row.productName,
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

/**
 * A stock row's catalog identity: product name, plus the variant and sku when
 * they add something. Single-variant products name the variant after the
 * product, so repeating it would just print the same words twice.
 */
function StockIdentity({ level }: { level: StockLevel }): ReactNode {
  const showVariant = level.variantName !== level.productName;
  const details = [showVariant ? level.variantName : null, level.sku].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  return (
    <span className="flex flex-col">
      <span className="font-medium">{level.productName}</span>
      {details.length > 0 ? (
        <span className="text-xs text-muted-foreground">{details.join(" · ")}</span>
      ) : null}
    </span>
  );
}
