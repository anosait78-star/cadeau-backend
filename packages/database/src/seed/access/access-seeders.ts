import type { SqlExecutor } from "../../types";
import type { Seeder, SeederResult } from "../types";
import { FEATURES, PERMISSIONS, PLANS, TEMPLATES } from "./catalog";

/**
 * System seeders for the EPIC-5 access catalog. Each is idempotent: catalog rows
 * are upserted with an `ON CONFLICT … DO UPDATE … WHERE row IS DISTINCT FROM
 * excluded` guard (so a re-run of unchanged data reports `changed: 0`), and the
 * many-to-many edges are inserted `ON CONFLICT DO NOTHING`. All seeders run in
 * the shared seed transaction, so the array order below satisfies the FKs
 * (features/permissions/plans/templates before their edges).
 *
 * The catalog tables are written here in the system/seed (null-principal)
 * context; the migration's RLS lets writes through only in that context, so the
 * running application can never mutate the catalog.
 */

const featuresSeeder: Seeder = {
  name: "access:features",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const f of FEATURES) {
      changed += await tx.$executeRaw`
        INSERT INTO public.features (key, name, category, is_active)
        VALUES (${f.key}, ${f.name}, ${f.category}, ${f.active})
        ON CONFLICT (key) DO UPDATE
          SET name = EXCLUDED.name,
              category = EXCLUDED.category,
              is_active = EXCLUDED.is_active
        WHERE (public.features.name, public.features.category, public.features.is_active)
              IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.category, EXCLUDED.is_active)
      `;
    }
    return { changed };
  },
};

const permissionsSeeder: Seeder = {
  name: "access:permissions",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const p of PERMISSIONS) {
      changed += await tx.$executeRaw`
        INSERT INTO public.permissions (key, description)
        VALUES (${p.key}, ${p.description})
        ON CONFLICT (key) DO UPDATE
          SET description = EXCLUDED.description
        WHERE public.permissions.description IS DISTINCT FROM EXCLUDED.description
      `;
    }
    return { changed };
  },
};

const featurePermissionsSeeder: Seeder = {
  name: "access:feature_permissions",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const p of PERMISSIONS) {
      if (p.feature === null) continue;
      changed += await tx.$executeRaw`
        INSERT INTO public.feature_permissions (feature_key, permission_key)
        VALUES (${p.feature}, ${p.key})
        ON CONFLICT (feature_key, permission_key) DO NOTHING
      `;
    }
    return { changed };
  },
};

const plansSeeder: Seeder = {
  name: "access:plans",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const plan of PLANS) {
      changed += await tx.$executeRaw`
        INSERT INTO public.plans (code, name, description)
        VALUES (${plan.code}, ${plan.name}, ${plan.description})
        ON CONFLICT (code) DO UPDATE
          SET name = EXCLUDED.name,
              description = EXCLUDED.description
        WHERE (public.plans.name, public.plans.description)
              IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description)
      `;
      for (const featureKey of plan.features) {
        changed += await tx.$executeRaw`
          INSERT INTO public.plan_features (plan_id, feature_key)
          SELECT p.id, ${featureKey}
          FROM public.plans p
          WHERE p.code = ${plan.code}
          ON CONFLICT (plan_id, feature_key) DO NOTHING
        `;
      }
    }
    return { changed };
  },
};

const templatesSeeder: Seeder = {
  name: "access:permission_templates",
  async run(tx: SqlExecutor): Promise<SeederResult> {
    let changed = 0;
    for (const t of TEMPLATES) {
      changed += await tx.$executeRaw`
        INSERT INTO public.permission_templates (key, name, description, is_system)
        VALUES (${t.key}, ${t.name}, ${t.description}, true)
        ON CONFLICT (key) DO UPDATE
          SET name = EXCLUDED.name,
              description = EXCLUDED.description
        WHERE (public.permission_templates.name, public.permission_templates.description)
              IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description)
      `;
      for (const permissionKey of t.permissions) {
        changed += await tx.$executeRaw`
          INSERT INTO public.role_permissions (template_id, permission_key)
          SELECT pt.id, ${permissionKey}
          FROM public.permission_templates pt
          WHERE pt.key = ${t.key}
          ON CONFLICT (template_id, permission_key) DO NOTHING
        `;
      }
    }
    return { changed };
  },
};

/** The access catalog system seeders, in FK-safe order. */
export const ACCESS_SEEDERS: readonly Seeder[] = [
  featuresSeeder,
  permissionsSeeder,
  featurePermissionsSeeder,
  plansSeeder,
  templatesSeeder,
];
