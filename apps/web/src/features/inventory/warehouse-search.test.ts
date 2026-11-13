import { describe, expect, it } from "vitest";
import { filterWarehouses, normalizeSearchText, sortWarehousesByName } from "./warehouse-search";

const wh = (name: string, code: string | null = null, address: string | null = null) => ({
  name,
  code,
  address,
});

const ARABIC = /[؀-ۿ]/;

describe("normalizeSearchText", () => {
  it("folds Arabic letter variants, diacritics and tatweel", () => {
    expect(normalizeSearchText("أإآ")).toBe("ااا");
    expect(normalizeSearchText("مكتبة")).toBe("مكتبه");
    expect(normalizeSearchText("مصطفى")).toBe("مصطفي");
    expect(normalizeSearchText("مَخْزَن")).toBe("مخزن");
    expect(normalizeSearchText("مـــخزن")).toBe("مخزن");
  });

  it("lower-cases and trims Latin text", () => {
    expect(normalizeSearchText("  Main HUB ")).toBe("main hub");
  });
});

describe("sortWarehousesByName", () => {
  it("orders Arabic names alphabetically", () => {
    const sorted = sortWarehousesByName([wh("ياسر"), wh("أحمد"), wh("بسمة"), wh("ثروت")]);
    expect(sorted.map((w) => w.name)).toEqual(["أحمد", "بسمة", "ثروت", "ياسر"]);
  });

  it("orders English names case-insensitively and numbers naturally", () => {
    const sorted = sortWarehousesByName([wh("beta"), wh("Store 10"), wh("Alpha"), wh("Store 2")]);
    expect(sorted.map((w) => w.name)).toEqual(["Alpha", "beta", "Store 2", "Store 10"]);
  });

  it("groups Arabic and English names instead of interleaving them", () => {
    const names = sortWarehousesByName([wh("Zed"), wh("باب"), wh("Ali"), wh("أمل")]).map(
      (w) => w.name,
    );
    const isArabic = names.map((n) => ARABIC.test(n));
    const switches = isArabic.filter((v, i) => i > 0 && v !== isArabic[i - 1]).length;
    expect(switches).toBe(1);
    expect(names.filter((n) => !ARABIC.test(n))).toEqual(["Ali", "Zed"]);
    expect(names.filter((n) => ARABIC.test(n))).toEqual(["أمل", "باب"]);
  });

  it("does not mutate its input", () => {
    const input = [wh("b"), wh("a")];
    sortWarehousesByName(input);
    expect(input.map((w) => w.name)).toEqual(["b", "a"]);
  });
});

describe("filterWarehouses", () => {
  const list = [wh("مخزن الإسكندرية", "ALX", "سموحة"), wh("Main", "MAIN", "Cairo"), wh("مكتبة")];

  it("returns everything for a blank query", () => {
    expect(filterWarehouses(list, "   ")).toHaveLength(3);
  });

  it("matches Arabic regardless of hamza or taa marbuta spelling", () => {
    expect(filterWarehouses(list, "الاسكندريه").map((w) => w.code)).toEqual(["ALX"]);
    expect(filterWarehouses(list, "مكتبه").map((w) => w.name)).toEqual(["مكتبة"]);
  });

  it("matches by code and address, case-insensitively", () => {
    expect(filterWarehouses(list, "main").map((w) => w.name)).toEqual(["Main"]);
    expect(filterWarehouses(list, "cai").map((w) => w.name)).toEqual(["Main"]);
    expect(filterWarehouses(list, "alx").map((w) => w.code)).toEqual(["ALX"]);
  });

  it("returns nothing when no warehouse matches", () => {
    expect(filterWarehouses(list, "zzz")).toEqual([]);
  });
});
