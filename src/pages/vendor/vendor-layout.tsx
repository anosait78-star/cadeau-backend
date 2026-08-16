import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * Minimal shell for the vendor account (Vendor Accounts, Phase 4) — a
 * standalone layout outside {@link AppShell} on purpose: a vendor's
 * permission template is `inventory.read` only (Phase 1), so the normal
 * sidebar/nav (Orders, Customers, Products, …) would be mostly forbidden/
 * empty for them. Only a sign-out affordance and the app name, matching the
 * same "nothing to show a company-less/scope-limited caller" pattern
 * {@link OnboardingLayout} already uses.
 */
export function VendorLayout({ children }: { children: ReactNode }): ReactNode {
  const { t } = useI18n();
  const { logout } = useAuth();

  return (
    <div className="flex min-h-full flex-col bg-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="font-semibold text-foreground">{t("vendor.dashboard.title")}</span>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t("user.signOut")}
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}
