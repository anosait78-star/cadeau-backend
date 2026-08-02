import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { importProducts, type ProductImportMapping } from "@/features/products/products-api";
import {
  importOrders,
  type ImportMapping as OrderImportMapping,
} from "@/features/orders/orders-api";
import { CsvImportCard, type ImportField } from "./csv-import-card";

const PRODUCT_FIELDS: readonly ImportField[] = [
  { key: "name", labelKey: "md.field.name", required: true },
  { key: "description", labelKey: "settings.dataImport.description", required: false },
  { key: "categoryId", labelKey: "settings.dataImport.categoryId", required: false },
  { key: "unitId", labelKey: "settings.dataImport.unitId", required: false },
  { key: "sku", labelKey: "settings.dataImport.sku", required: false },
  { key: "barcode", labelKey: "settings.dataImport.barcode", required: false },
];

const ORDER_FIELDS: readonly ImportField[] = [
  { key: "customerId", labelKey: "settings.dataImport.customerId", required: true },
  { key: "variantId", labelKey: "settings.dataImport.variantId", required: true },
  { key: "quantity", labelKey: "settings.dataImport.quantity", required: true },
  { key: "price", labelKey: "settings.dataImport.price", required: true },
  { key: "shippingFee", labelKey: "settings.dataImport.shippingFee", required: false },
  { key: "discount", labelKey: "settings.dataImport.discount", required: false },
];

/** Only pass through fields the caller actually mapped to a header. */
function pickMapped(selected: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(selected)) {
    if (value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Data-import settings tab: bulk-import Products and Orders from a CSV export
 * (Excel/Sheets "Save as CSV"). Each importer maps its own columns explicitly
 * — no format guessing — mirroring the orders module's existing CSV importer
 * (EPIC-11) on the backend; the Products importer is new (this epic).
 */
export function DataImportPanel(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <FeatureGate feature="products">
        <PermissionGate permission="products.manage">
          <CsvImportCard
            titleKey="settings.dataImport.productsTitle"
            descriptionKey="settings.dataImport.productsDescription"
            fields={PRODUCT_FIELDS}
            buildMapping={(selected) => pickMapped(selected) as unknown as ProductImportMapping}
            onImport={importProducts}
          />
        </PermissionGate>
      </FeatureGate>

      <FeatureGate feature="orders">
        <PermissionGate permission="orders.manage">
          <CsvImportCard
            titleKey="settings.dataImport.ordersTitle"
            descriptionKey="settings.dataImport.ordersDescription"
            fields={ORDER_FIELDS}
            buildMapping={(selected) => pickMapped(selected) as unknown as OrderImportMapping}
            onImport={importOrders}
          />
        </PermissionGate>
      </FeatureGate>
    </div>
  );
}
