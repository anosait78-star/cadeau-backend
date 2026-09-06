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

/**
 * A governorate. `nameAr` is the exact Arabic string this country's storefront
 * checkout(s) use for the governorate — matched literally (never fuzzy) against
 * a storefront order's `_billing_governorate`/`_shipping_governorate` webhook
 * meta (storefront-address-sync). `undefined` where no storefront integration
 * needs it yet.
 */
export interface GovernorateDef {
  readonly name: string;
  readonly nameAr?: string;
}

/** A country config and its governorates. `currency` points at a CurrencyDef code. */
export interface CountryDef {
  readonly code: string;
  readonly name: string;
  readonly currency: string;
  readonly phoneCode: string;
  readonly governorates: readonly GovernorateDef[];
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
      { name: "Cairo", nameAr: "القاهرة" },
      { name: "Giza", nameAr: "الجيزة" },
      { name: "Alexandria", nameAr: "الإسكندرية" },
      { name: "Dakahlia", nameAr: "الدقهلية" },
      { name: "Red Sea", nameAr: "البحر الأحمر" },
      { name: "Beheira", nameAr: "البحيرة" },
      { name: "Fayoum", nameAr: "الفيوم" },
      { name: "Gharbia", nameAr: "الغربية" },
      { name: "Ismailia", nameAr: "الإسماعيلية" },
      { name: "Menofia", nameAr: "المنوفية" },
      { name: "Minya", nameAr: "المنيا" },
      { name: "Qalyubia", nameAr: "القليوبية" },
      { name: "New Valley", nameAr: "الوادي الجديد" },
      { name: "Suez", nameAr: "السويس" },
      { name: "Aswan", nameAr: "أسوان" },
      { name: "Assiut", nameAr: "أسيوط" },
      { name: "Beni Suef", nameAr: "بني سويف" },
      { name: "Port Said", nameAr: "بور سعيد" },
      { name: "Damietta", nameAr: "دمياط" },
      { name: "Sharqia", nameAr: "الشرقية" },
      { name: "South Sinai", nameAr: "جنوب سيناء" },
      { name: "Kafr El Sheikh", nameAr: "كفر الشيخ" },
      { name: "Matrouh", nameAr: "مرسى مطروح" },
      { name: "Luxor", nameAr: "الأقصر" },
      { name: "Qena", nameAr: "قنا" },
      // Not an option in the cadeauegypt.com checkout's governorate dropdown
      // (storefront discovery, 2026-09-06) — left unmapped rather than guessed.
      { name: "North Sinai" },
      { name: "Sohag", nameAr: "سوهاج" },
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
