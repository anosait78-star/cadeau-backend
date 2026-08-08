import type { TranslationKey } from "@/i18n/dictionaries";

/**
 * Human-readable module group label per backend feature key (EPIC-5 catalog:
 * master-data, products, inventory, customers, orders, shipping, finance,
 * analytics, notifications — `ai` is excluded, it ships inactive/no
 * permissions). Used to group the custom-role permission picker. An unknown
 * future feature key just falls back to its raw key instead of crashing.
 */
export const MODULE_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
  "master-data": "team.module.masterData",
  products: "team.module.products",
  inventory: "team.module.inventory",
  customers: "team.module.customers",
  orders: "team.module.orders",
  shipping: "team.module.shipping",
  finance: "team.module.finance",
  analytics: "team.module.analytics",
  notifications: "team.module.notifications",
};

/** Group key for the two feature-independent core permissions (`access.*`). */
export const CORE_MODULE_KEY = "__core__";
