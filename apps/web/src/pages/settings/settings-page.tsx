import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { EmptyState } from "@/components/states/empty-state";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { DataImportPanel } from "./data-import-panel";
import { GeneralPanel } from "./general-panel";
import { NotificationsPage } from "./notifications-page";
import { ReasonsPanel } from "./reasons-panel";
import { SecurityPanel } from "./security-panel";
import { ShippingPanel } from "./shipping-panel";
import { StorefrontPanel } from "./storefront-panel";
import { WhatsappPanel } from "./whatsapp-panel";

interface SettingsTab {
  readonly key: string;
  readonly labelKey: TranslationKey;
}

const TABS: readonly SettingsTab[] = [
  { key: "general", labelKey: "settings.tab.general" },
  { key: "data-import", labelKey: "settings.tab.dataImport" },
  { key: "security", labelKey: "settings.tab.security" },
  { key: "whatsapp", labelKey: "settings.tab.whatsapp" },
  { key: "notifications", labelKey: "settings.tab.notifications" },
  { key: "shipping", labelKey: "settings.tab.shipping" },
  { key: "storefront", labelKey: "settings.tab.storefront" },
  { key: "reasons", labelKey: "settings.tab.reasons" },
];

/**
 * The Settings screen (`/settings/:tab?`): a shared tab bar over a set of
 * independent panels. "reasons" and "shipping" are wired to the existing
 * master-data / shipping APIs; the rest are placeholders until their own
 * epic delivers the real screen.
 */
export function SettingsPage(): ReactNode {
  const { t } = useI18n();
  const { tab: rawTab } = useParams<{ tab?: string }>();
  const activeTab = TABS.find((tb) => tb.key === rawTab) ?? TABS[0]!;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("nav.settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </header>

      <nav aria-label={t("nav.settings")} className="flex flex-wrap gap-2 border-b border-border">
        {TABS.map((tb) => (
          <Link
            key={tb.key}
            to={`/settings/${tb.key}`}
            aria-current={tb.key === activeTab.key ? "page" : undefined}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm font-medium transition-colors",
              tb.key === activeTab.key
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tb.labelKey)}
          </Link>
        ))}
      </nav>

      <SettingsTabContent tabKey={activeTab.key} />
    </div>
  );
}

function SettingsTabContent({ tabKey }: { tabKey: string }): ReactNode {
  const { t } = useI18n();

  if (tabKey === "general") return <GeneralPanel />;
  if (tabKey === "data-import") return <DataImportPanel />;
  if (tabKey === "security") return <SecurityPanel />;
  if (tabKey === "whatsapp") return <WhatsappPanel />;
  if (tabKey === "reasons") return <ReasonsPanel />;
  if (tabKey === "shipping") return <ShippingPanel />;
  if (tabKey === "storefront") return <StorefrontPanel />;
  if (tabKey === "notifications") return <NotificationsPage />;

  const labelKey = TABS.find((tb) => tb.key === tabKey)?.labelKey ?? "settings.tab.general";
  return <EmptyState title={t(labelKey)} description={t("placeholder.description")} />;
}
