import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * Centered layout for the post-login, pre-company onboarding screens
 * (`/onboarding/*`). The caller is authenticated but has no active company
 * yet, so this renders outside {@link AppShell} — there is no sidebar/nav to
 * show. Only a sign-out affordance is offered (no theme/language toggles;
 * those are already chosen by the time the user is signed in).
 */
export function OnboardingLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}): ReactNode {
  const { t } = useI18n();
  const { logout } = useAuth();

  return (
    <div className="flex min-h-full flex-col bg-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t("user.signOut")}
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center gap-8 p-4 pt-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <BuildingLogo />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}

function BuildingLogo(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 22V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v18" />
      <path d="M14 9h4a1 1 0 0 1 1 1v12" />
      <path d="M9 6h1M9 10h1M9 14h1M9 18h1M17 13h1M17 17h1" />
    </svg>
  );
}
