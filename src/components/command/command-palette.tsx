import { Command } from "cmdk";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { NAV_ITEMS } from "@/config/navigation";
import { useI18n } from "@/i18n/i18n-provider";
import { useTheme } from "@/providers/theme-provider";

/**
 * The ⌘K command palette: fuzzy-searchable navigation + quick actions. Built on
 * cmdk (keyboard-first, accessible) inside a Radix dialog. Open state is owned by
 * the {@link CommandPaletteProvider}.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const navigate = useNavigate();
  const { t, toggleLocale } = useI18n();
  const { toggleTheme } = useTheme();

  const run = (action: () => void): void => {
    onOpenChange(false);
    action();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("command.trigger")}
      overlayClassName="fixed inset-0 z-50 bg-black/50"
      contentClassName="fixed left-1/2 top-[15%] z-50 w-[92%] max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
      className="flex flex-col"
    >
      <Command.Input
        placeholder={t("command.placeholder")}
        className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-80 overflow-auto p-2">
        <Command.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">
          {t("command.empty")}
        </Command.Empty>

        <Command.Group heading={t("command.navigation")}>
          {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
            <Command.Item
              key={to}
              value={t(labelKey)}
              onSelect={() => run(() => void navigate(to))}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading={t("command.actions")}>
          <Command.Item value={t("actions.toggleTheme")} onSelect={() => run(toggleTheme)}>
            {t("actions.toggleTheme")}
          </Command.Item>
          <Command.Item value={t("command.switchLanguage")} onSelect={() => run(toggleLocale)}>
            {t("command.switchLanguage")}
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
