import {
  BarChart3,
  Database,
  LayoutDashboard,
  Package,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Users,
  UsersRound,
  Warehouse,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n/dictionaries";

/** One primary navigation destination (data-driven, shared by both shells). */
export interface NavItem {
  readonly to: string;
  readonly labelKey: TranslationKey;
  readonly icon: LucideIcon;
  /** `true` for the index route so it only matches exactly. */
  readonly end?: boolean;
  /** Feature key required for this destination (three-layer access, EPIC-5). */
  readonly feature?: string;
  /** Permission key required for this destination (three-layer access, EPIC-5). */
  readonly permission?: string;
  /** When true, the destination is shown only to platform Super-Admins (EPIC-5). */
  readonly superAdmin?: boolean;
}

/**
 * Primary navigation. Both the Desktop sidebar and the Mobile bottom nav render
 * from this single source, filtered by the caller's capabilities (a destination
 * with a `feature`/`permission` requirement is hidden unless it is satisfied).
 * Destinations for not-yet-built epics render a placeholder until their epic
 * delivers the real screen.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/orders", labelKey: "nav.orders", icon: ShoppingCart, feature: "orders" },
  { to: "/customers", labelKey: "nav.customers", icon: Users, feature: "customers" },
  { to: "/products", labelKey: "nav.products", icon: Package, feature: "products" },
  { to: "/inventory", labelKey: "nav.inventory", icon: Warehouse, feature: "inventory" },
  { to: "/finance", labelKey: "nav.finance", icon: Wallet, feature: "finance" },
  {
    to: "/analytics",
    labelKey: "nav.analytics",
    icon: BarChart3,
    feature: "analytics",
    permission: "analytics.read",
  },
  {
    to: "/master-data",
    labelKey: "nav.masterData",
    icon: Database,
    feature: "master-data",
    permission: "master-data.read",
  },
  { to: "/settings/roles", labelKey: "nav.roles", icon: ShieldCheck, permission: "access.read" },
  { to: "/settings/team", labelKey: "nav.team", icon: UsersRound, permission: "access.read" },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
  { to: "/admin", labelKey: "nav.admin", icon: ShieldAlert, superAdmin: true },
];
