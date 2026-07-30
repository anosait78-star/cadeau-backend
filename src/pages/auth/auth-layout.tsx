import type { ReactNode } from "react";
import { AppActions } from "@/components/shell/app-actions";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * Centered layout for the public auth screens. A single responsive layout (not a
 * Dual Shell): the shells are for the authenticated app; sign-in is one card
 * that reads identically on desktop and mobile. Language + theme toggles stay
 * available so the choice is made before signing in.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}): ReactNode {
  const { t } = useI18n();

  return (
    <div className="flex min-h-full flex-col bg-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <span className="text-lg font-semibold text-primary">{t("app.name")}</span>
        <AppActions />
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm shadow-sm">
          <CardContent className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {children}
            {footer !== undefined ? (
              <p className="text-center text-sm text-muted-foreground">{footer}</p>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
