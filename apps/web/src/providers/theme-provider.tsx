import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "cadeau.theme";

interface ThemeContextValue {
  readonly theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

/** The status-bar / browser-chrome color per theme — the shell surface color. */
const THEME_COLOR: Record<Theme, string> = { light: "#ffffff", dark: "#0b0b0c" };

/**
 * Repoints every `<meta name="theme-color">` at the active theme. index.html
 * declares one tag per OS color scheme so the very first paint is close; once
 * the app knows which theme the user actually chose, both are overwritten with
 * the same value so the OS preference can no longer win over the in-app toggle.
 */
function applyThemeColor(theme: Theme): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const meta of metas) meta.content = THEME_COLOR[theme];
}

/**
 * Provides the active color theme. Persists the choice, applies it as
 * `data-theme` on <html> (which the design tokens key off), keeps the device
 * status bar in sync, and seeds the initial value from a previous choice or the
 * OS preference.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    applyThemeColor(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
