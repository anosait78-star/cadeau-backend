import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { NAV_ITEMS } from "@/config/navigation";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/** The primary destinations shown directly in the bottom bar; the rest go to "More". */
export const MOBILE_PRIMARY = NAV_ITEMS.slice(0, 4);
export const MOBILE_OVERFLOW = NAV_ITEMS.slice(4);

/** Fixed bottom navigation for the Mobile shell: primary destinations + a "More" button. */
export function MobileBottomNav({ onMore }: { onMore: () => void }): ReactNode {
  const { t } = useI18n();

  const itemClass = "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs";

  return (
    <nav
      aria-label={t("nav.bottom")}
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-card"
    >
      {MOBILE_PRIMARY.map(({ to, labelKey, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          className={({ isActive }) =>
            cn(itemClass, isActive ? "text-primary" : "text-muted-foreground")
          }
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span>{t(labelKey)}</span>
        </NavLink>
      ))}
      <button type="button" onClick={onMore} className={cn(itemClass, "text-muted-foreground")}>
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        <span>{t("nav.more")}</span>
      </button>
    </nav>
  );
}
