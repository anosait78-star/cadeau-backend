import type { TranslationKey } from "@/i18n/dictionaries";

/** The translator shape this module needs. */
type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * Role names. The seven invitable roles reuse the invite dialog's existing
 * keys, so a role is called the same thing on both screens; `vendor` is not
 * invitable there, so it has its own.
 */
const NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  owner: "team.invite.role.owner",
  manager: "team.invite.role.manager",
  store_manager: "team.invite.role.store_manager",
  call_center: "team.invite.role.call_center",
  warehouse: "team.invite.role.warehouse",
  finance: "team.invite.role.finance",
  marketing: "team.invite.role.marketing",
  vendor: "team.role.vendor",
};

const DESCRIPTION_KEYS: Readonly<Record<string, TranslationKey>> = {
  owner: "team.role.owner.desc",
  manager: "team.role.manager.desc",
  store_manager: "team.role.store_manager.desc",
  call_center: "team.role.call_center.desc",
  warehouse: "team.role.warehouse.desc",
  finance: "team.role.finance.desc",
  marketing: "team.role.marketing.desc",
  vendor: "team.role.vendor.desc",
};

/**
 * A permission template's name and description in the active language.
 *
 * The API sends the seed catalog's English `name` and `description` verbatim —
 * they are data, shared by every client, so they are not localized on the
 * server. This maps the known template keys to translations, the same approach
 * `permissionLabel` takes for permissions.
 *
 * An unknown key (a template added after this build) falls back to the API's
 * own text rather than showing nothing: English is better than a blank card.
 */
export function templateLabel(
  template: { readonly key: string; readonly name: string; readonly description: string | null },
  t: Translate,
): { readonly name: string; readonly description: string | null } {
  const nameKey = NAME_KEYS[template.key];
  const descriptionKey = DESCRIPTION_KEYS[template.key];
  return {
    name: nameKey === undefined ? template.name : t(nameKey),
    description: descriptionKey === undefined ? template.description : t(descriptionKey),
  };
}
