import { LayoutDashboard, Package, Settings, ShoppingCart, Users, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n/dictionaries";

/** One primary navigation destination (data-driven, shared by both shells). */
export interface NavItem {
  readonly to: string;
  readonly labelKey: TranslationKey;
  readonly icon: LucideIcon;
  /** `true` for the index route so it only matches exactly. */
  readonly end?: boolean;
}

/**
 * Primary navigation. Both the Desktop sidebar and the (later) Mobile bottom nav
 * render from this single source. Destinations for not-yet-built epics render a
 * placeholder until their epic delivers the real screen.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/orders", labelKey: "nav.orders", icon: ShoppingCart },
  { to: "/customers", labelKey: "nav.customers", icon: Users },
  { to: "/products", labelKey: "nav.products", icon: Package },
  { to: "/inventory", labelKey: "nav.inventory", icon: Warehouse },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];
