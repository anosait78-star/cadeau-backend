import type { TranslationKey } from "@/i18n/dictionaries";
import { CORE_MODULE_KEY, MODULE_LABEL_KEYS } from "./team-module-labels";

/** The translator shape this module needs — `t` with interpolation params. */
type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A permission rendered for display: a name, a sentence, and its action tone. */
export interface PermissionLabel {
  readonly name: string;
  readonly description: string;
  /** `null` for the four permissions that are not a plain `<module>.<action>` pair. */
  readonly action: "read" | "manage" | null;
}

/**
 * The permissions whose meaning is not simply "<action> the <module>", so they
 * carry their own name and sentence rather than being derived.
 *
 * Everything else in the catalog is a `<feature>.read` / `<feature>.manage`
 * pair, and those are composed from the module label the picker already groups
 * by — which is why adding a module stays a one-key change (ADR-004) instead of
 * two more translations per language.
 */
const SPECIAL_KEYS: Readonly<Record<string, readonly [TranslationKey, TranslationKey]>> = {
  "access.read": ["team.permission.access.read.name", "team.permission.access.read.desc"],
  "access.manage": ["team.permission.access.manage.name", "team.permission.access.manage.desc"],
  "orders.assign": ["team.permission.orders.assign.name", "team.permission.orders.assign.desc"],
  "integrations.manage": [
    "team.permission.integrations.manage.name",
    "team.permission.integrations.manage.desc",
  ],
};

/**
 * The display label for a permission group. `featureKey` is `null` for the
 * feature-independent core permissions; an unrecognized future key falls back
 * to itself rather than throwing.
 */
export function moduleLabel(featureKey: string, t: Translate): string {
  if (featureKey === CORE_MODULE_KEY) return t("team.module.core");
  const key = MODULE_LABEL_KEYS[featureKey];
  return key === undefined ? featureKey : t(key);
}

/**
 * A permission's name and description in the active language.
 *
 * The API sends the catalog's English `description` straight from the seed, so
 * it cannot be localized server-side. Rather than translating 22 rows twice,
 * this derives the common case — `<feature>.<read|manage>` — from the module
 * label plus one word for the action, and keeps a small table for the four keys
 * that genuinely say something else.
 *
 * An unknown key (a permission added after this build) degrades to the raw key
 * as its name with no description, which is exactly what the picker used to
 * show for every permission.
 */
export function permissionLabel(
  permission: { readonly key: string; readonly featureKey: string | null },
  t: Translate,
): PermissionLabel {
  const special = SPECIAL_KEYS[permission.key];
  if (special !== undefined) {
    return { name: t(special[0]), description: t(special[1]), action: actionOf(permission.key) };
  }

  const action = actionOf(permission.key);
  if (action === null || permission.featureKey === null) {
    return { name: permission.key, description: "", action: null };
  }

  const module = moduleLabel(permission.featureKey, t);
  return {
    name: `${t(`team.permission.action.${action}`)} ${module}`,
    description: t(`team.permission.desc.${action}`, { module }),
    action,
  };
}

/** The `read`/`manage` suffix of a permission key, or null for anything else. */
function actionOf(key: string): "read" | "manage" | null {
  if (key.endsWith(".read")) return "read";
  if (key.endsWith(".manage")) return "manage";
  return null;
}
