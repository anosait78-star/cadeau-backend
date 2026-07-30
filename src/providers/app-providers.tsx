import type { ReactNode } from "react";
import { AuthProvider } from "@/auth/auth-provider";
import { CapabilitiesProvider } from "@/features/access/capabilities-provider";
import { I18nProvider } from "@/i18n/i18n-provider";
import { ThemeProvider } from "@/providers/theme-provider";

/**
 * Composes the app-wide providers (theme + i18n/direction + session +
 * capabilities). Capabilities live inside the session so they can react to the
 * active tenant. Shared by the real entry point and by tests so both wrap
 * components identically.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <CapabilitiesProvider>{children}</CapabilitiesProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
