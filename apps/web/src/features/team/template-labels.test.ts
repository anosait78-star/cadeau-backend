import { describe, expect, it } from "vitest";
import { ar, en, type TranslationKey } from "@/i18n/dictionaries";
import { templateLabel } from "./template-labels";

const t = (key: TranslationKey): string => ar[key];
const tEn = (key: TranslationKey): string => (en as Record<TranslationKey, string>)[key];

const OWNER = {
  key: "owner",
  name: "Owner",
  description: "Full access to everything in the company.",
};

describe("templateLabel", () => {
  it("translates a known role instead of showing the seed's English", () => {
    const label = templateLabel(OWNER, t);
    expect(label.name).toBe("مالك");
    expect(label.description).toBe("صلاحية كاملة على كل شيء في الشركة.");
  });

  it("names a role the same as the invite dialog does", () => {
    // Reuses `team.invite.role.*`, so a role is not called two different
    // things on two screens.
    expect(
      templateLabel({ key: "store_manager", name: "Store Manager", description: null }, t).name,
    ).toBe(ar["team.invite.role.store_manager"]);
  });

  it("covers the vendor role, which the invite dialog has no key for", () => {
    expect(templateLabel({ key: "vendor", name: "Vendor", description: null }, t).name).toBe(
      "تاجر",
    );
  });

  it("follows the active language", () => {
    expect(templateLabel(OWNER, tEn).name).toBe("Owner");
  });

  it("falls back to the API's own text for a template this build does not know", () => {
    const label = templateLabel(
      { key: "auditor", name: "Auditor", description: "Read-only audit." },
      t,
    );
    expect(label).toEqual({ name: "Auditor", description: "Read-only audit." });
  });
});
