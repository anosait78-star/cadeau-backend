import { useContext } from "react";
import { NAV_ITEMS, type NavItem } from "@/config/navigation";
import { CapabilitiesContext } from "./capabilities-context";

/**
 * The primary navigation filtered by the caller's capabilities: a destination
 * with a `feature`/`permission` requirement is dropped unless it is satisfied.
 * Degrades gracefully — until capabilities are resolved (or with no provider, as
 * in isolated component tests) it returns the full list, so nav never flickers
 * empty while loading. In production the shell is always behind an authenticated
 * `CapabilitiesProvider`, so gated items resolve to hidden once ready.
 */
export function useNavItems(): readonly NavItem[] {
  const caps = useContext(CapabilitiesContext);
  if (caps === undefined || caps.status !== "ready") return NAV_ITEMS;
  return NAV_ITEMS.filter((item) => {
    if (item.superAdmin === true && !caps.isSuperAdmin) return false;
    if (item.feature === undefined && item.permission === undefined) return true;
    return caps.has({
      ...(item.feature !== undefined ? { feature: item.feature } : {}),
      ...(item.permission !== undefined ? { permission: item.permission } : {}),
    });
  });
}
