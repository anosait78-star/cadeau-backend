import { describe, expect, it } from "vitest";
import { foldForSearch, matchesSearch } from "./search-text";

describe("foldForSearch — Arabic spelling variants", () => {
  // Each of these scored zero under cmdk's character-by-character comparison,
  // which dropped the product from the list rather than ranking it lower.
  it.each([
    ["أزرق", "ازرق"],
    ["إسورة", "اسورة"],
    ["آيفون", "ايفون"],
    ["عباية", "عبايه"],
    ["حقيبة", "حقيبه"],
    ["مصطفى", "مصطفي"],
  ])("folds %s and %s to the same text", (written, typed) => {
    expect(foldForSearch(written)).toBe(foldForSearch(typed));
  });

  it("ignores tashkeel and tatweel", () => {
    expect(foldForSearch("قَمِيص")).toBe(foldForSearch("قميص"));
    expect(foldForSearch("قـــميص")).toBe(foldForSearch("قميص"));
  });

  it("collapses repeated whitespace", () => {
    expect(foldForSearch("قميص   قطن")).toBe("قميص قطن");
  });
});

describe("foldForSearch — digits and case", () => {
  it("folds Arabic-Indic digits to ASCII", () => {
    expect(foldForSearch("١٠٢٣")).toBe("1023");
  });

  it("folds the Persian digit range too", () => {
    expect(foldForSearch("۱۰۲۳")).toBe("1023");
  });

  it("lowercases Latin text", () => {
    expect(foldForSearch("Blue SHIRT")).toBe("blue shirt");
  });
});

describe("foldForSearch — what it must not do", () => {
  // Widening what matches is the point; merging distinct products is not.
  it("keeps genuinely different words apart", () => {
    expect(foldForSearch("قميص")).not.toBe(foldForSearch("قمیص کتان"));
    expect(foldForSearch("احمر")).not.toBe(foldForSearch("اخضر"));
    expect(foldForSearch("1023")).not.toBe(foldForSearch("1024"));
  });

  it("leaves an empty string empty", () => {
    expect(foldForSearch("")).toBe("");
    expect(foldForSearch("   ")).toBe("");
  });
});

describe("matchesSearch", () => {
  it("finds a product however its Arabic is spelled", () => {
    expect(matchesSearch("قميص قطن أزرق", "ازرق")).toBe(true);
    expect(matchesSearch("عباية سوداء", "عبايه")).toBe(true);
  });

  // Word-by-word, so the query's words need not be adjacent or in order.
  it("matches words in any order, with gaps between them", () => {
    expect(matchesSearch("قميص قطن أزرق", "قميص ازرق")).toBe(true);
    expect(matchesSearch("قميص قطن أزرق", "ازرق قميص")).toBe(true);
  });

  it("requires every word of the query to appear", () => {
    expect(matchesSearch("قميص قطن أزرق", "قميص اخضر")).toBe(false);
  });

  it("matches a partial word, the way a search box should", () => {
    expect(matchesSearch("قميص قطن", "قمي")).toBe(true);
  });

  it("shows everything when nothing has been typed", () => {
    expect(matchesSearch("أي منتج", "")).toBe(true);
    expect(matchesSearch("أي منتج", "   ")).toBe(true);
  });

  it("matches an order number typed in either digit set", () => {
    expect(matchesSearch("منتج 1023", "١٠٢٣")).toBe(true);
    expect(matchesSearch("منتج ١٠٢٣", "1023")).toBe(true);
  });

  it("does not match an unrelated product", () => {
    expect(matchesSearch("قميص قطن أزرق", "فستان")).toBe(false);
  });
});
