import type { ReactNode } from "react";
import { AuthProvider } from "@/auth/auth-provider";
import { ToastProvider } from "@/components/toast/toast";
import { CapabilitiesProvider } from "@/features/access/capabilities-provider";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { I18nProvider } from "@/i18n/i18n-provider";
import { ThemeProvider } from "@/providers/theme-provider";

/**
 * Composes the app-wide providers (theme + i18n/direction + session +
 * capabilities). Capabilities live inside the session so they can react to the
 * active tenant. Shared by the real entry point and by tests so both wrap
 * components identically.
 *
 * Also publishes the on-screen keyboard's height as a CSS variable: the
 * surfaces that need it are portaled outside this tree, so it has to be global.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  useKeyboardInset();
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <CapabilitiesProvider>{children}</CapabilitiesProvider>
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
