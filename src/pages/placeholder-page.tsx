import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * A navigable placeholder for a route whose feature ships in a later epic. Keeps
 * the shells' navigation real and testable before the domain screens exist.
 */
export function PlaceholderPage({ titleKey }: { titleKey: TranslationKey }): ReactNode {
  const { t } = useI18n();
  return <EmptyState title={t(titleKey)} description={t("placeholder.description")} />;
}
