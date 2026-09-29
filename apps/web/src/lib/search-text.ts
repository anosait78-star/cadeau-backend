import { canonicalizeArabicName } from "./arabic-name";

/**
 * Folds text so a search matches what people actually type.
 *
 * Arabic is written with several spellings of the same word, and nobody types
 * the careful one into a search box: "أزرق" is typed "ازرق", "عباية" is typed
 * "عبايه", "مصطفى" is typed "مصطفي". Comparing the raw characters treats these
 * as different letters, so the product is not ranked lower — it is dropped
 * from the list entirely, which is what made the order form look like it was
 * missing products.
 *
 * On top of {@link canonicalizeArabicName}'s letter rules this folds:
 *  - Arabic-Indic digits (٠-٩ and ۰-۹) to ASCII, so an order or SKU typed on an
 *    Arabic keyboard finds one stored in Western digits
 *  - case, so Latin product names match however they are typed
 *
 * For comparison only — never store or display the result. Two genuinely
 * different words never fold to the same string; this widens what matches, it
 * does not merge distinct products.
 *
 * The API performs the same folding in SQL (`app.search_fold`, see the
 * product-variant search migration). The two must stay in step: a rule added
 * here and not there means the server hides a row the client would have shown.
 */
export function foldForSearch(value: string): string {
  return canonicalizeArabicName(value)
    .replace(/[٠-٩۰-۹]/g, foldDigit)
    .toLowerCase();
}

/** One Arabic-Indic digit as its ASCII equivalent. */
function foldDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0;
  // Arabic-Indic ٠..٩ start at U+0660; the Extended (Persian) ۰..۹ at U+06F0.
  const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
  return String((code - base).toString());
}

/**
 * Whether `haystack` matches everything in `needle`.
 *
 * Every whitespace-separated word of the query must appear somewhere in the
 * text, in any order — so "قميص ازرق" finds "قميص قطن أزرق", which a
 * left-to-right substring match would miss. An empty query matches everything,
 * which is what an untouched search box should do.
 */
export function matchesSearch(haystack: string, needle: string): boolean {
  const folded = foldForSearch(needle);
  if (folded.length === 0) return true;
  const target = foldForSearch(haystack);
  return folded.split(" ").every((word) => target.includes(word));
}
