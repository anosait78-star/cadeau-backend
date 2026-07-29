import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { useCommandPalette } from "@/providers/command-palette-provider";

/**
 * Floating action button (Mobile). Opens the command palette — the mobile entry
 * point to search + navigation + quick actions (the ⌘K equivalent, since mobile
 * has no keyboard). Positioned with logical `end-4` so it mirrors in RTL. Domain
 * screens may add their own primary-create FAB on top of this foundation.
 */
export function MobileFab(): ReactNode {
  const { t } = useI18n();
  const { toggle } = useCommandPalette();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("command.trigger")}
      className="fixed bottom-20 end-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
    >
      <Search className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
