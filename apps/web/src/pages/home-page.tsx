import { useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n/i18n-provider";

const SWATCHES = ["bg-primary", "bg-muted", "bg-destructive", "bg-foreground"] as const;

/** Landing page that showcases the foundation: standard states + design tokens. */
export function HomePage(): ReactNode {
  const { t } = useI18n();
  const [retries, setRetries] = useState(0);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t("home.title")}</h1>
        <p className="text-muted-foreground">{t("home.description")}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("home.statesHeading")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <LoadingState />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                title={t("home.demoEmptyTitle")}
                description={t("home.demoEmptyDescription")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <ErrorState
                description={t("home.demoErrorDescription")}
                onRetry={() => setRetries((count) => count + 1)}
              />
            </CardContent>
          </Card>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="retry-count">
          {retries}
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("home.tokensHeading")}</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
        <div className="flex flex-wrap gap-3">
          {SWATCHES.map((swatch) => (
            <div
              key={swatch}
              className={`h-10 w-10 rounded-md border border-border ${swatch}`}
              title={swatch}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
