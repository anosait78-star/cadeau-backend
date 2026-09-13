import {
  Building2,
  Car,
  Megaphone,
  Package,
  Tag,
  Truck,
  UsersRound,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** How an expense category is drawn: an icon and a color. */
export interface ExpenseCategoryStyle {
  readonly icon: LucideIcon;
  /** A theme token, so the color follows light and dark mode. */
  readonly color: string;
}

/**
 * Categories are free text, so they are recognised by the words people
 * actually type for them, in Arabic or English. The colors reuse the board's
 * status tokens, which are already tuned for both themes.
 */
const KNOWN: readonly {
  readonly words: readonly string[];
  readonly style: ExpenseCategoryStyle;
}[] = [
  {
    words: ["كهربا", "electric", "power"],
    style: { icon: Zap, color: "var(--status-confirming)" },
  },
  {
    words: ["اعلان", "دعايه", "تسويق", "advert", "marketing"],
    style: { icon: Megaphone, color: "var(--status-new)" },
  },
  { words: ["ايجار", "rent"], style: { icon: Building2, color: "var(--status-processing)" } },
  {
    words: ["راتب", "رواتب", "مرتب", "اجور", "salar", "payroll", "wage"],
    style: { icon: UsersRound, color: "var(--status-delivered)" },
  },
  {
    words: ["شحن", "توصيل", "shipping", "delivery", "courier"],
    style: { icon: Truck, color: "var(--status-returned)" },
  },
  {
    words: ["انترنت", "اتصالات", "تليفون", "internet", "phone", "telecom"],
    style: { icon: Wifi, color: "var(--status-exchanged)" },
  },
  {
    words: ["صيانه", "تصليح", "maintenance", "repair"],
    style: { icon: Wrench, color: "var(--status-postponed)" },
  },
  {
    words: ["مواصلات", "بنزين", "وقود", "transport", "fuel", "travel"],
    style: { icon: Car, color: "var(--status-completed)" },
  },
  {
    words: ["تغليف", "خامات", "مستلزمات", "packag", "material", "supplies"],
    style: { icon: Package, color: "var(--status-ready)" },
  },
];

/** Colors for categories no keyword matches, picked stably by name. */
const FALLBACK_COLORS = [
  "var(--status-processing)",
  "var(--status-returned)",
  "var(--status-exchanged)",
  "var(--status-completed)",
  "var(--status-postponed)",
  "var(--status-ready)",
] as const;

/** Folds the spellings people mix up (أ/إ/آ, ة/ه, ى/ي) so a keyword matches all of them. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

/** The icon and color for a category; the same name always gets the same style. */
export function expenseCategoryStyle(category: string): ExpenseCategoryStyle {
  const text = normalize(category);
  const known = KNOWN.find((entry) => entry.words.some((word) => text.includes(normalize(word))));
  if (known !== undefined) return known.style;

  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return { icon: Tag, color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length] ?? FALLBACK_COLORS[0] };
}

/** A translucent wash of `color`, for chip and icon backgrounds. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** `color` pulled toward the foreground, so text in it stays readable on its own tint. */
export function tintText(color: string): string {
  return `color-mix(in srgb, ${color} 75%, var(--foreground))`;
}
