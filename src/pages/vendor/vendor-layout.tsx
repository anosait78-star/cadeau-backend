import { Home, LogOut, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import type { TranslationKey } from "@/i18n/dictionaries";

interface VendorNavItem {
  readonly to: string;
  readonly labelKey: TranslationKey;
  readonly icon: typeof Home;
  readonly end: boolean;
}

const NAV_ITEMS: readonly VendorNavItem[] = [
  { to: "/vendor", labelKey: "vendor.nav.home", icon: Home, end: true },
  { to: "/vendor/orders", labelKey: "vendor.nav.orders", icon: ShoppingBag, end: false },
];

/**
 * Shell for the vendor account (Vendor Accounts, Phase 4, given real
 * navigation in Phase 7) — a standalone layout outside {@link AppShell} on
 * purpose: a vendor's permission template is `inventory.read` only (Phase 1),
 * so the normal sidebar (Orders, Customers, Products, …) would be mostly
 * forbidden/empty for them. Nav is deliberately just "Home / Orders / Sign
 * out" — every company-only surface stays unreachable, not merely hidden
 * (the actual boundary is server-side: `RequireAuth` keeps a vendor inside
 * `/vendor/*`, and every vendor API call is scoped by warehouse regardless of
 * what the client ever renders).
 */
export function VendorLayout({ children }: { children: ReactNode }): ReactNode {
  const { t } = useI18n();
  const { logout } = useAuth();

  return (
    <div className="flex min-h-full flex-col bg-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4">
        <span className="font-semibold text-foreground">{t("vendor.dashboard.title")}</span>
        <nav aria-label={t("vendor.nav.label")} className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t(labelKey)}</span>
            </NavLink>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("user.signOut")}</span>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}
