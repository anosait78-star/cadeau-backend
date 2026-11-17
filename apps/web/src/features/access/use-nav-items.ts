import { useContext } from "react";
import { useAuth } from "@/auth/use-auth";
import { NAV_ITEMS, VENDOR_NAV_ITEMS, type NavItem } from "@/config/navigation";
import { CapabilitiesContext } from "./capabilities-context";

/**
 * The primary navigation filtered by the caller's capabilities: a destination
 * with a `feature`/`permission` requirement is dropped unless it is satisfied.
 * Degrades gracefully — until capabilities are resolved (or with no provider, as
 * in isolated component tests) it returns the full list, so nav never flickers
 * empty while loading. In production the shell is always behind an authenticated
 * `CapabilitiesProvider`, so gated items resolve to hidden once ready.
 *
 * A `"vendor"` member gets {@link VENDOR_NAV_ITEMS} instead — the same shell
 * (sidebar/bottom nav/palette) renders it, so the UI matches the company shell
 * exactly, just with the shorter, always-permitted list appropriate to a
 * warehouse-scoped account.
 */
export function useNavItems(): readonly NavItem[] {
  const { user } = useAuth();
  const caps = useContext(CapabilitiesContext);
  const activeRole = user?.companies.find((c) => c.id === user.activeCompanyId)?.role ?? null;
  // The vendor list is filtered by the same rules: its ungated items always
  // pass, and a gated one (vendor payouts) shows only when the company has it.
  const items = activeRole === "vendor" ? VENDOR_NAV_ITEMS : NAV_ITEMS;

  if (caps === undefined || caps.status !== "ready") return items;
  return items.filter((item) => {
    if (item.superAdmin === true && !caps.isSuperAdmin) return false;
    if (item.feature === undefined && item.permission === undefined) return true;
    return caps.has({
      ...(item.feature !== undefined ? { feature: item.feature } : {}),
      ...(item.permission !== undefined ? { permission: item.permission } : {}),
    });
  });
}
