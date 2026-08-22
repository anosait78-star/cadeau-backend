import { useCallback, useEffect, useState } from "react";
import { listMyVendorProducts, type VendorProduct } from "./vendor-products-api";

export type VendorProductsState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly products: VendorProduct[] };

/**
 * Fetches the caller's own warehouse's products (Vendor Accounts). This is
 * also the actual security boundary, not just a data source: the endpoint
 * only ever returns products stocked in the caller's own warehouse (resolved
 * server-side from their `CompanyMember`), so there is nothing for the UI to
 * filter or hide — mirrors {@link useMyVendorGroups} exactly.
 */
export function useMyVendorProducts(): {
  readonly state: VendorProductsState;
  readonly reload: () => void;
} {
  const [state, setState] = useState<VendorProductsState>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const { data } = await listMyVendorProducts();
      setState({ kind: "ready", products: data });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: () => void load() };
}
