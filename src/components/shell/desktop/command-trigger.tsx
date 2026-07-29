import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";
import { useCommandPalette } from "@/providers/command-palette-provider";

/** Topbar button that opens the ⌘K command palette (with a keyboard hint). */
export function CommandTrigger(): ReactNode {
  const { t } = useI18n();
  const { toggle } = useCommandPalette();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      className="text-muted-foreground"
      aria-keyshortcuts="Meta+K Control+K"
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span>{t("command.trigger")}</span>
      <kbd className="ms-2 rounded border border-border px-1.5 py-0.5 text-xs" aria-hidden="true">
        ⌘K
      </kbd>
    </Button>
  );
}
