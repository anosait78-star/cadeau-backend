/**
 * The EPIC-7 master-data system catalog — the single source of truth for the
 * system reference data every tenant shares: currencies (ISO-4217), country
 * configs (ISO-3166 alpha-2), and their governorates. The seeders in
 * `./master-data-seeders.ts` upsert exactly this, idempotently, so it lives in
 * code and ships to every environment.
 *
 * Tenant-editable master data (units, categories, order labels/reasons, shipping
 * zones) is NOT seeded here — each company curates its own rows through the API.
 */

/** A currency in the catalog (ISO-4217). */
export interface CurrencyDef {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimalDigits: number;
}

/** A country config and its governorates. `currency` points at a CurrencyDef code. */
export interface CountryDef {
  readonly code: string;
  readonly name: string;
  readonly currency: string;
  readonly phoneCode: string;
  readonly governorates: readonly string[];
}

/** Currencies relevant to the launch markets, plus the majors used for pricing. */
export const CURRENCIES: readonly CurrencyDef[] = [
  { code: "EGP", name: "Egyptian Pound", symbol: "E£", decimalDigits: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", decimalDigits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimalDigits: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", decimalDigits: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimalDigits: 2 },
];

/**
 * Country configs. Egypt ships with its 27 governorates (the launch market); the
 * others are lightweight anchors that later markets extend.
 */
export const COUNTRIES: readonly CountryDef[] = [
  {
    code: "EG",
    name: "Egypt",
    currency: "EGP",
    phoneCode: "+20",
    governorates: [
      "Cairo",
      "Giza",
      "Alexandria",
      "Dakahlia",
      "Red Sea",
      "Beheira",
      "Fayoum",
      "Gharbia",
      "Ismailia",
      "Menofia",
      "Minya",
      "Qalyubia",
      "New Valley",
      "Suez",
      "Aswan",
      "Assiut",
      "Beni Suef",
      "Port Said",
      "Damietta",
      "Sharqia",
      "South Sinai",
      "Kafr El Sheikh",
      "Matrouh",
      "Luxor",
      "Qena",
      "North Sinai",
      "Sohag",
    ],
  },
  { code: "SA", name: "Saudi Arabia", currency: "SAR", phoneCode: "+966", governorates: [] },
  {
    code: "AE",
    name: "United Arab Emirates",
    currency: "AED",
    phoneCode: "+971",
    governorates: [],
  },
];
