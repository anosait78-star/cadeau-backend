/**
 * Canonicalizes an Arabic place name for comparison only (never for
 * storage/display) — collapses spelling variants that are the same place
 * spelled two ways, never two different places into one:
 *  - trailing ة/ه (e.g. Bosta's "المنوفيه" vs the storefront's "المنوفية")
 *  - أ/إ/آ → ا, ى → ي (common alternate spellings)
 *  - diacritics (tashkeel) and the ـ tatweel elongation character
 *  - repeated whitespace
 * This is still an exact-match gate, not fuzzy search: two genuinely
 * different names never canonicalize to the same string.
 */
export function canonicalizeArabicName(value: string): string {
  return value
    .trim()
    .replace(/[ً-ْـ]/g, "") // tashkeel + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}
