import { useState } from "react";
import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { useI18n } from "@/i18n/i18n-provider";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileFab } from "./mobile-fab";
import { MobileMoreSheet } from "./mobile-more-sheet";

/**
 * Mobile shell (ADR-002): a native-feeling experience — top brand bar, scrollable
 * content, a floating action button, and a fixed bottom navigation with a "More"
 * bottom sheet (swipe-down to dismiss). An independent tree from the Desktop
 * shell, not a reflow of it.
 */
export function MobileShell(): ReactNode {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col pb-16">
      <header className="sticky top-0 z-20 flex h-14 items-center border-b border-border bg-background px-4">
        <span className="text-lg font-semibold text-primary">{t("app.name")}</span>
      </header>

      <main className="flex-1 p-4">
        <Outlet />
      </main>

      <MobileFab />
      <MobileBottomNav onMore={() => setMoreOpen(true)} />
      <MobileMoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </div>
  );
}
