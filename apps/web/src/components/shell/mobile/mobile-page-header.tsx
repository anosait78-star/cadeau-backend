import { ChevronLeft, Search } from "lucide-react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { CompanySwitcher } from "@/components/shell/company-switcher";
import { NotificationBell } from "@/components/shell/notification-bell";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { useCommandPalette } from "@/providers/command-palette-provider";
import { useMobileBack } from "./use-mobile-back";

/**
 * The compact top bar of the Mobile shell. It is the navigation *hierarchy*: a
 * root destination shows the brand and hands its title to the large title below
 * (which the bar adopts once that scrolls away), while a deeper screen shows a
 * back control and its title immediately.
 *
 * Trailing controls are the ones that belong to the app rather than the screen —
 * search (the command palette, since a phone has no ⌘K), notifications, and the
 * company switcher. The screen's own create action lives in the FAB.
 */
export function MobilePageHeader({
  title,
  isRoot,
  collapsed,
}: {
  title: string;
  isRoot: boolean;
  collapsed: boolean;
}): ReactNode {
  const { t } = useI18n();
  const { toggle } = useCommandPalette();
  const goBack = useMobileBack();

  // The bar shows the title when there is no large title to defer to (deeper
  // screens), or once the large title has scrolled out of view.
  const showTitle = !isRoot || collapsed;

  return (
    <header className="mobile-header chrome-blur sticky top-0 z-20 flex items-center gap-1 border-b border-border">
      {isRoot ? (
        <span
          className={cn(
            // Collapsing must free the space, not just hide the ink: faded out
            // but still laid out, the brand went on squeezing the title it had
            // just handed over to.
            "shrink-0 overflow-hidden whitespace-nowrap text-lg font-semibold text-primary",
            "transition-all duration-200",
            collapsed ? "w-0 opacity-0" : "opacity-100",
          )}
        >
          {t("app.name")}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            haptic("tap");
            goBack();
          }}
          aria-label={t("nav.back")}
          className="pressable touch-target -ms-2 flex items-center justify-center rounded-full text-foreground"
        >
          {/* Logical mirroring: the chevron points back, which is rightwards in RTL. */}
          <ChevronLeft className="h-6 w-6 rtl:rotate-180" aria-hidden="true" />
        </button>
      )}

      {/* Visual only: on a root screen this restates the large title below, and
          on a deeper screen the page still owns the document heading. */}
      <p
        aria-hidden={!showTitle}
        className={cn(
          "min-w-0 flex-1 truncate text-center text-base font-semibold text-foreground transition-opacity duration-200",
          showTitle ? "opacity-100" : "opacity-0",
        )}
      >
        {title}
      </p>

      {/* Capped so a long company name can never crowd the title out of the
          bar; the switcher truncates its own label within whatever it gets. */}
      <div className="flex max-w-[55%] shrink items-center justify-end gap-1">
        <button
          type="button"
          onClick={toggle}
          aria-label={t("command.trigger")}
          className="pressable touch-target flex items-center justify-center rounded-full text-foreground"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
        <FeatureGate feature="notifications">
          <NotificationBell />
        </FeatureGate>
        <CompanySwitcher />
      </div>
    </header>
  );
}

/**
 * The large title at the top of a root screen — the thing the compact bar
 * collapses into. The sentinel above it is what {@link useScrollCollapse}
 * watches, so the swap happens exactly when the title leaves the viewport.
 */
export function MobileLargeTitle({
  title,
  sentinelRef,
}: {
  title: string;
  sentinelRef: (node: HTMLElement | null) => void;
}): ReactNode {
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <h1 className="mb-4 text-display text-foreground">{title}</h1>
    </>
  );
}
