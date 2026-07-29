import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { NAV_ITEMS } from "@/config/navigation";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/** Desktop-only left sidebar: brand + primary navigation (logical `border-e`). */
export function DesktopSidebar(): ReactNode {
  const { t } = useI18n();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-e border-border bg-card">
      <div className="flex h-14 items-center px-4 text-lg font-semibold text-primary">
        {t("app.name")}
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label={t("nav.primary")}>
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
