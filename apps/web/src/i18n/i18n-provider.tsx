import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { dictionaries, directionForLocale, type Locale, type TranslationKey } from "./dictionaries";

const STORAGE_KEY = "cadeau.locale";

type Direction = "rtl" | "ltr";
type TranslateVars = Record<string, string | number>;

interface I18nContextValue {
  readonly locale: Locale;
  readonly dir: Direction;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, vars?: TranslateVars) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function readInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "ar" || stored === "en" ? stored : "ar";
}

function interpolate(template: string, vars?: TranslateVars): string {
  if (vars === undefined) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Provides translations and text direction. The locale is the single source of
 * truth for both language and direction: choosing Arabic sets `lang="ar"` and
 * `dir="rtl"` on <html>, English sets `lang="en"` / `dir="ltr"`. Persisted, so a
 * reload keeps the choice.
 */
export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);
  const dir = directionForLocale(locale);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", locale);
    root.setAttribute("dir", dir);
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale, dir]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const toggleLocale = useCallback(
    () => setLocaleState((current) => (current === "ar" ? "en" : "ar")),
    [],
  );

  const t = useCallback(
    (key: TranslationKey, vars?: TranslateVars) => interpolate(dictionaries[locale][key], vars),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir, setLocale, toggleLocale, t }),
    [locale, dir, setLocale, toggleLocale, t],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
