import type { TranslationKey } from "@/i18n/dictionaries";

/** Canonical shape of the `t` function returned by `useI18n()`. */
export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;
