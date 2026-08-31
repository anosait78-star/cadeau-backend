import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { PageTitle } from "@/components/layout/page-title";
import { useMyVendorProducts } from "@/features/vendor/use-my-vendor-products";
import type { VendorProduct } from "@/features/vendor/vendor-products-api";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "@/lib/format-money";

/**
 * "منتجاتي" — a read-only product catalog for the vendor (Vendor Accounts),
 * scoped to their own warehouse. Every card here comes from
 * `GET /v1/vendor/products`, itself the server-side isolation boundary (a
 * vendor cannot receive another warehouse's products from this endpoint) —
 * there is nothing here to leak, and no write action at all: no add/edit/
 * delete, matching the endpoint, which exposes none either.
 */
export function VendorProductsPage(): ReactNode {
  const { t, locale } = useI18n();
  const { state, reload } = useMyVendorProducts();

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t("vendor.products.title")} description={t("vendor.products.subtitle")} />

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={reload} /> : null}

      {state.kind === "ready" && state.products.length === 0 ? (
        <EmptyState title={t("vendor.products.empty")} />
      ) : null}

      {state.kind === "ready" && state.products.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {state.products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              locale={locale}
              available={t("vendor.products.available")}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProductCard({
  product,
  locale,
  available,
}: {
  product: VendorProduct;
  locale: string;
  available: string;
}): ReactNode {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-3 text-center">
        <ProductThumb imageUrl={product.imageUrl} size="md" className="h-20 w-20" />
        <p className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</p>
        <p className="text-sm font-semibold tabular-nums" dir="ltr">
          {formatMoney(product.priceMinor, locale)}
        </p>
        <p className="text-xs text-muted-foreground">
          {available}: <span className="tabular-nums">{product.availableQuantity}</span>
        </p>
      </CardContent>
    </Card>
  );
}
