import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { useNavItems } from "@/features/access/use-nav-items";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";

/** How many primary destinations sit directly in the bottom bar; the rest go to "More". */
export const MOBILE_PRIMARY_COUNT = 4;

/** Fixed bottom navigation for the Mobile shell: primary destinations + a "More" button. */
export function MobileBottomNav({ onMore }: { onMore: () => void }): ReactNode {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const primary = useNavItems().slice(0, MOBILE_PRIMARY_COUNT);

  const itemClass =
    "pressable flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.625rem] leading-none";
  const pillClass = "flex h-7 w-12 items-center justify-center rounded-full transition-colors";

  return (
    <nav
      aria-label={t("nav.bottom")}
      className="mobile-nav chrome-blur fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border"
    >
      {primary.map(({ to, labelKey, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          // Tapping the tab you are already on returns that list to the top
          // instead of re-navigating — the iOS tab-bar convention.
          onClick={(event) => {
            haptic("tap");
            if (pathname !== to) return;
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className={({ isActive }) =>
            cn(itemClass, isActive ? "text-primary" : "text-muted-foreground")
          }
        >
          {({ isActive }) => (
            <>
              {/* The active tab carries a filled pill behind its icon rather than
                  relying on color alone: legible at a glance, and it works for
                  every destination's icon. */}
              <span className={cn(pillClass, isActive ? "bg-primary/10" : "bg-transparent")}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>{t(labelKey)}</span>
            </>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          onMore();
        }}
        className={cn(itemClass, "text-muted-foreground")}
      >
        <span className={pillClass}>
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </span>
        <span>{t("nav.more")}</span>
      </button>
    </nav>
  );
}
