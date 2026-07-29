import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";
import { useTheme } from "@/providers/theme-provider";

/**
 * The shared header actions (language + theme toggles), reused by both the
 * Desktop topbar and the Mobile header so the controls stay identical across
 * shells (ADR-002: shells share the visual identity, not the layout).
 */
export function AppActions(): ReactNode {
  const { theme, toggleTheme } = useTheme();
  const { t, toggleLocale } = useI18n();

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={toggleLocale}>
        {t("actions.toggleLanguage")}
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={toggleTheme}
        aria-label={t("actions.toggleTheme")}
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
