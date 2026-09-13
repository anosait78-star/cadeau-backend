import {
  Coins,
  Crown,
  Handshake,
  Headphones,
  Megaphone,
  Shield,
  ShieldCheck,
  Store,
  Warehouse,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n/dictionaries";
import { CUSTOM_ROLE } from "./team-api";
import { templateLabel } from "./template-labels";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const ICONS: Readonly<Record<string, LucideIcon>> = {
  owner: ShieldCheck,
  manager: Crown,
  store_manager: Store,
  call_center: Headphones,
  warehouse: Warehouse,
  finance: Coins,
  marketing: Megaphone,
  vendor: Handshake,
};

/** The roles that have their own `--role-<key>` token in globals.css. */
const COLORED = new Set([...Object.keys(ICONS), CUSTOM_ROLE]);

/** A role's icon; a role added after this build gets a plain shield. */
export function roleIcon(role: string): LucideIcon {
  return ICONS[role] ?? Shield;
}

/** A role's color as a CSS value; an unknown role shares the neutral `custom` hue. */
export function roleColor(role: string): string {
  return `var(--role-${COLORED.has(role) ? role : CUSTOM_ROLE})`;
}

/** `color` at `percent`% over transparent — the tint behind chips, icons and avatars. */
export function roleTint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/**
 * Text in a role's hue that stays readable on its own tint: pulled toward the
 * foreground, which darkens it in the light theme and lightens it in the dark.
 */
export function roleText(color: string): string {
  return `color-mix(in srgb, ${color} 70%, var(--foreground))`;
}

/** A role's display name, including `custom` (which has no template). */
export function roleName(role: string, t: Translate): string {
  if (role === CUSTOM_ROLE) return t("team.role.custom");
  return templateLabel({ key: role, name: role, description: null }, t).name;
}

/**
 * Permission keys ordered "most significant first", for the few chips a card
 * has room for: the core `access.*` permissions, then anything that manages,
 * then the rest, then plain reads. Ties keep their original order.
 */
export function rankPermissions(keys: readonly string[]): string[] {
  const score = (key: string): number => {
    const core = key.startsWith("access.") ? 0 : 10;
    if (key.endsWith(".manage")) return core;
    if (key.endsWith(".read")) return core + 2;
    return core + 1;
  };
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => score(a.key) - score(b.key) || a.index - b.index)
    .map((entry) => entry.key);
}

/** Initials for an avatar: the first letter of the first two words of the name, else the email. */
export function initials(name: string | null, email: string): string {
  const source = name !== null && name.trim().length > 0 ? name.trim() : email;
  const words = source.split(/\s+/).filter((w) => w.length > 0);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase();
}
