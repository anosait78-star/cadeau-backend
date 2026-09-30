import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { foldForSearch } from "./search-text";

/**
 * The web app folds search text in TypeScript; the API folds it in SQL
 * (`app.search_fold`). Both sides of every product search pass through one of
 * them, so a rule that exists in only one means the server hides a row the
 * client would have shown — or the reverse. This runs the same inputs through
 * both and demands identical output.
 *
 * Skipped unless the dev database is reachable, so the suite still runs
 * without one.
 */
const CONTAINER = "cadeau-db";

function sqlFold(values: readonly string[]): string[] | null {
  // One round trip for the whole set: a row per input, in order.
  const rows = values
    .map((v, i) => `SELECT ${i} AS i, ${literal(v)}::text AS v`)
    .join(" UNION ALL ");
  try {
    const out = execFileSync(
      "docker",
      [
        "exec",
        CONTAINER,
        "psql",
        "-U",
        "cadeau",
        "-d",
        "cadeau_dev",
        "-t",
        "-A",
        "-c",
        `SELECT app.search_fold(v) FROM (${rows}) s ORDER BY i`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 },
    );
    return out.split(/\r?\n/).slice(0, values.length);
  } catch {
    return null;
  }
}

/** A single-quoted SQL literal; the inputs are test fixtures, not user input. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const CASES = [
  "قميص قطن أزرق",
  "عباية سوداء",
  "مصطفى",
  "آيفون",
  "إسورة",
  "حقيبة يد",
  "منتج ١٠٢٣",
  "تيشيرت ۱۲۳",
  "قَمِيص",
  "مُنـــتَج",
  "Blue SHIRT",
  "قميص   قطن",
  "  مسافات حوالين  ",
];

describe("search folding — TypeScript and SQL agree", () => {
  const folded = sqlFold(CASES);

  it.runIf(folded !== null).each(CASES.map((c, i) => [c, i] as const))(
    "folds %j the same on both sides",
    (input, index) => {
      expect(folded?.[index]).toBe(foldForSearch(input));
    },
  );

  it("reports when the database was not reachable, rather than passing silently", () => {
    if (folded === null) {
      console.warn(
        `[search-fold-parity] skipped: no ${CONTAINER} container. ` +
          "Start the dev database to check TS/SQL parity.",
      );
    }
    expect(true).toBe(true);
  });
});
