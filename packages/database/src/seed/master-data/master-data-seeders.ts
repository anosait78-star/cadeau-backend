import type { SqlExecutor } from "../../types";
import type { Seeder, SeederResult } from "../types";
import { COUNTRIES, CURRENCIES } from "./catalog";

/**
 * System seeders for the EPIC-7 master-data reference catalog. Each is
 * idempotent: rows are upserted with an `ON CONFLICT … DO UPDATE … WHERE row IS
 * DISTINCT FROM excluded` guard (so a re-run of unchanged data reports
 * `changed: 0`). The array order below satisfies the FKs (currencies before
 * country_configs before governorates).
 *
 * The reference tables are written here in the system/seed (null-principal)
 * context; the migration's RLS lets writes through only in that context, so the
 * running application can never mutate this catalog — it is edited only through a
 * code change + re-seed.
 */

const currenciesSeeder: Seeder = {
  name: "master-data:currencies",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const c of CURRENCIES) {
      changed += await tx.$executeRaw`
        INSERT INTO public.currencies (code, name, symbol, decimal_digits)
        VALUES (${c.code}, ${c.name}, ${c.symbol}, ${c.decimalDigits})
        ON CONFLICT (code) DO UPDATE
          SET name = EXCLUDED.name,
              symbol = EXCLUDED.symbol,
              decimal_digits = EXCLUDED.decimal_digits
        WHERE (public.currencies.name, public.currencies.symbol, public.currencies.decimal_digits)
              IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.symbol, EXCLUDED.decimal_digits)
      `;
    }
    return { changed };
  },
};

const countryConfigsSeeder: Seeder = {
  name: "master-data:country_configs",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const country of COUNTRIES) {
      changed += await tx.$executeRaw`
        INSERT INTO public.country_configs (code, name, default_currency_code, phone_code)
        VALUES (${country.code}, ${country.name}, ${country.currency}, ${country.phoneCode})
        ON CONFLICT (code) DO UPDATE
          SET name = EXCLUDED.name,
              default_currency_code = EXCLUDED.default_currency_code,
              phone_code = EXCLUDED.phone_code
        WHERE (public.country_configs.name, public.country_configs.default_currency_code, public.country_configs.phone_code)
              IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.default_currency_code, EXCLUDED.phone_code)
      `;
    }
    return { changed };
  },
};

const governoratesSeeder: Seeder = {
  name: "master-data:governorates",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const country of COUNTRIES) {
      for (const name of country.governorates) {
        changed += await tx.$executeRaw`
          INSERT INTO public.governorates (country_code, name)
          VALUES (${country.code}, ${name})
          ON CONFLICT (country_code, name) DO NOTHING
        `;
      }
    }
    return { changed };
  },
};

/** The master-data reference system seeders, in FK-safe order. */
export const MASTER_DATA_SEEDERS: readonly Seeder[] = [
  currenciesSeeder,
  countryConfigsSeeder,
  governoratesSeeder,
];
