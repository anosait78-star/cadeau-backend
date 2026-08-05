import { ChevronsLeft, ChevronsRight, LogOut, ShoppingBag, UserRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useAuth } from "@/auth/use-auth";
import { useNavItems } from "@/features/access/use-nav-items";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "cadeau.sidebar.collapsed";

/** Destinations rendered under the "Core settings" section, at the bottom of the rail. */
const CORE_SECTION_PREFIXES = ["/settings", "/admin"];

function readInitialCollapsed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

/**
 * Desktop-only left sidebar: floating card with brand mark, grouped primary
 * navigation, and an account footer (logical `border-e`). Collapsible to an
 * icon-only rail with hover tooltips; the choice persists across sessions.
 */
export function DesktopSidebar(): ReactNode {
  const { t } = useI18n();
  const navItems = useNavItems();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const { primaryItems, coreItems } = useMemo(() => {
    const core = navItems.filter((item) => CORE_SECTION_PREFIXES.some((prefix) => item.to.startsWith(prefix)));
    const primary = navItems.filter((item) => !core.includes(item));
    return { primaryItems: primary, coreItems: core };
  }, [navItems]);

  const identity = user?.fullName ?? user?.email ?? t("user.account");

  const renderNavLink = (item: (typeof navItems)[number]) => {
    const { to, labelKey, icon: Icon, end } = item;
    const label = t(labelKey);
    return (
      <NavLink
        key={to}
        to={to}
        end={end ?? false}
        className={({ isActive }) =>
          cn(
            "group/nav-item relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
            "transition-all duration-200 ease-out",
            isActive
              ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
              : "text-foreground/80 hover:translate-x-0.5 hover:bg-muted hover:text-foreground rtl:hover:-translate-x-0.5",
            collapsed && "justify-center px-0 hover:translate-x-0 rtl:hover:translate-x-0",
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              className={cn("h-[18px] w-[18px] shrink-0", isActive && "stroke-[2.25]")}
              aria-hidden="true"
            />
            <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
            {collapsed && (
              <span
                role="presentation"
                className={cn(
                  "pointer-events-none absolute start-full z-20 ms-3 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg",
                  "translate-x-1 rtl:-translate-x-1",
                  "transition-all duration-150 ease-out group-hover/nav-item:translate-x-0 group-hover/nav-item:opacity-100",
                )}
              >
                {label}
              </span>
            )}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <aside
      className={cn(
        "relative m-3 flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg",
        "transition-[width] duration-300 ease-out",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-border/70 px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
          <ShoppingBag className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
          <p className="truncate text-h3 leading-tight text-foreground">{t("app.name")}</p>
          <p className="truncate text-caption text-muted-foreground">{t("app.tagline")}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        className={cn(
          "absolute top-14 z-30 flex h-7 w-7 items-center justify-center rounded-full border border-border",
          "bg-card text-muted-foreground shadow-md transition-all duration-200",
          "hover:scale-110 hover:border-primary/40 hover:text-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          collapsed ? "end-1/2 translate-x-1/2 rtl:-translate-x-1/2" : "end-3",
        )}
      >
        {collapsed ? (
          <ChevronsLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
        ) : (
          <ChevronsRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
        )}
      </button>

      <nav
        className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4"
        aria-label={t("nav.primary")}
      >
        <div className="flex flex-col gap-1">{primaryItems.map(renderNavLink)}</div>

        {coreItems.length > 0 && (
          <div className="mt-4 flex flex-col gap-1">
            <p
              className={cn(
                "px-3 pb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground/70",
                collapsed && "sr-only",
              )}
            >
              {t("sidebar.section.core")}
            </p>
            {collapsed && <div className="mx-2 mb-2 border-t border-border/70" aria-hidden="true" />}
            {coreItems.map(renderNavLink)}
          </div>
        )}
      </nav>

      <div className="border-t border-border/70 p-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl bg-muted/60 p-2",
            collapsed && "flex-col justify-center gap-2 bg-transparent p-0",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5" title={collapsed ? identity : undefined}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
              <span className="block truncate text-sm font-medium text-foreground">{identity}</span>
              {user?.email && identity !== user.email && (
                <span className="block truncate text-caption text-muted-foreground">{user.email}</span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label={t("user.signOut")}
            title={t("user.signOut")}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
              "transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
