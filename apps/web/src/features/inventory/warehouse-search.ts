/** The fields the warehouse search and sort read. */
export interface SearchableWarehouse {
  readonly name: string;
  readonly code: string | null;
  readonly address: string | null;
}

/**
 * Arabic-aware collation: letters in dictionary order, case/diacritics ignored,
 * and embedded numbers compared numerically ("Store 2" before "Store 10").
 */
const COLLATOR = new Intl.Collator(["ar", "en"], { sensitivity: "base", numeric: true });

/**
 * Fold text so spelling variants match: hamza forms of alef → ا, ة → ه, ى → ي,
 * diacritics (tashkeel) and tatweel dropped, Latin lower-cased, ends trimmed.
 */
export function normalizeSearchText(text: string): string {
  return text
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .trim();
}

/** A new array of the warehouses ordered alphabetically by name. */
export function sortWarehousesByName<T extends SearchableWarehouse>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => COLLATOR.compare(a.name, b.name));
}

/** The warehouses whose name, code or address contain the query (all when blank). */
export function filterWarehouses<T extends SearchableWarehouse>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = normalizeSearchText(query);
  if (needle.length === 0) return [...items];
  return items.filter((w) =>
    [w.name, w.code, w.address].some(
      (field) => field !== null && normalizeSearchText(field).includes(needle),
    ),
  );
}
