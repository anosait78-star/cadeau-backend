import { useCallback, useEffect, useState } from "react";
import { listMyVendorGroups, type VendorGroup } from "./vendor-api";

export type VendorGroupsState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly groups: VendorGroup[] };

/**
 * Fetches the caller's own vendor groups (Vendor Accounts, Phase 3), shared
 * by the vendor dashboard, orders list, and order detail screens (Phase 7)
 * so each doesn't re-implement the same loading/error wiring. Reuses the
 * existing `GET /v1/vendor/order-groups` endpoint as-is — no new API.
 *
 * This is also the actual security boundary, not just a data source: the
 * endpoint only ever returns groups routed to the caller's own warehouse
 * (resolved server-side from their `CompanyMember`), so a group belonging to
 * another vendor simply never appears in `groups` — there is nothing for the
 * UI to filter or hide. The order detail screen relies on exactly this: it
 * looks up a `groupId` from the URL within this same list, so tampering with
 * the id in the URL can only ever resolve to "not found," never to another
 * vendor's data.
 */
export function useMyVendorGroups(): {
  readonly state: VendorGroupsState;
  readonly reload: () => void;
  readonly patchGroup: (group: VendorGroup) => void;
} {
  const [state, setState] = useState<VendorGroupsState>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const { data } = await listMyVendorGroups();
      setState({ kind: "ready", groups: data });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchGroup = (updated: VendorGroup): void => {
    setState((prev) =>
      prev.kind === "ready"
        ? { kind: "ready", groups: prev.groups.map((g) => (g.id === updated.id ? updated : g)) }
        : prev,
    );
  };

  return { state, reload: () => void load(), patchGroup };
}
