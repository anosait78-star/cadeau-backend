import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/i18n-provider";
import type { Locale, TranslationKey } from "@/i18n/dictionaries";

/**
 * The "General" settings tab: a second entry point for the language switch
 * (the header keeps its own button — this is a duplicate, not a replacement)
 * plus a subscription summary placeholder until billing/plans are modeled.
 */
export function GeneralPanel(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <LanguageCard />
      <SubscriptionCard />
    </div>
  );
}

function LanguageCard(): ReactNode {
  const { t, locale, setLocale } = useI18n();
  const options: readonly { readonly value: Locale; readonly labelKey: TranslationKey }[] = [
    { value: "ar", labelKey: "settings.general.arabic" },
    { value: "en", labelKey: "settings.general.english" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.general.languageTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("settings.general.languageSubtitle")}</p>
        <div className="flex gap-2">
          {options.map((option) => (
            <Button
              key={option.value}
              variant={locale === option.value ? "primary" : "outline"}
              aria-pressed={locale === option.value}
              onClick={() => setLocale(option.value)}
            >
              {t(option.labelKey)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SubscriptionCard(): ReactNode {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.general.subscriptionTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("settings.general.subscriptionPending")}</p>
      </CardContent>
    </Card>
  );
}
