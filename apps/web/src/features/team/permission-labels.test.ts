import { describe, expect, it } from "vitest";
import { ar, en, type TranslationKey } from "@/i18n/dictionaries";
import { moduleLabel, permissionLabel } from "./permission-labels";
import { CORE_MODULE_KEY } from "./team-module-labels";

/** A translator over one dictionary, mirroring `I18nProvider`'s interpolation. */
function translator(dict: Record<TranslationKey, string>) {
  return (key: TranslationKey, vars?: Record<string, string | number>): string => {
    const template = dict[key];
    if (vars === undefined) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
    );
  };
}

const t = translator(ar);
const tEn = translator(en as Record<TranslationKey, string>);

describe("permissionLabel", () => {
  it("composes a <feature>.read label from the module name and the action", () => {
    const label = permissionLabel({ key: "orders.read", featureKey: "orders" }, t);
    expect(label.name).toBe("عرض الطلبات");
    expect(label.description).toBe("الاطّلاع على الطلبات دون إجراء أي تعديل.");
    expect(label.action).toBe("read");
  });

  it("composes a <feature>.manage label the same way", () => {
    const label = permissionLabel({ key: "inventory.manage", featureKey: "inventory" }, t);
    expect(label.name).toBe("إدارة المخزون");
    expect(label.action).toBe("manage");
  });

  it("follows the active language", () => {
    expect(permissionLabel({ key: "orders.read", featureKey: "orders" }, tEn).name).toBe(
      "View Orders",
    );
  });

  it("uses a bespoke label for the permissions that are not a plain module action", () => {
    // `orders.assign` also widens visibility, which "assign orders" alone does
    // not say — so it is one of the four keys with their own sentence.
    const assign = permissionLabel({ key: "orders.assign", featureKey: "orders" }, t);
    expect(assign.name).toBe("إسناد الطلبات");
    expect(assign.description).toContain("رؤية كل طلبات الشركة");

    expect(permissionLabel({ key: "access.manage", featureKey: null }, t).name).toBe(
      "إدارة الصلاحيات",
    );
    expect(
      permissionLabel({ key: "integrations.manage", featureKey: "storefront_integration" }, t).name,
    ).toBe("إدارة ربط المتجر");
  });

  it("degrades to the raw key for a permission added after this build", () => {
    const label = permissionLabel({ key: "future.thing", featureKey: "future" }, t);
    expect(label.name).toBe("future.thing");
    expect(label.description).toBe("");
    expect(label.action).toBeNull();
  });

  it("translates every module the catalog groups by, including storefront integration", () => {
    // The gap this closed: `integrations.manage` grouped under the raw feature
    // key because no label existed for it.
    expect(moduleLabel("storefront_integration", t)).toBe("الربط");
    expect(moduleLabel(CORE_MODULE_KEY, t)).toBe("عام");
    expect(moduleLabel("unknown-module", t)).toBe("unknown-module");
  });
});
