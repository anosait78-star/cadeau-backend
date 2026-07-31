/**
 * Deterministic smart-paste (EPIC-11, ADR-0004). Turns a blob of pasted text —
 * the kind a seller copies from a WhatsApp/Messenger chat — into structured draft
 * order fields, using **Regex + heuristics only**. There is no AI here, by design
 * and by CI guard (`no-ai-imports`): the same input always yields the same output.
 *
 * The parser is intentionally conservative: it extracts what it is confident
 * about (a phone that normalizes, a labeled field, an obvious `qty × name` line)
 * and leaves the rest in `notes`, so a human always confirms before anything is
 * created. It never resolves ids — a variant name here is a *string*; mapping it
 * to a real variant is the caller's explicit step.
 */

/** A parsed order line: a free-text item name and a quantity. */
export interface ParsedItem {
  readonly name: string;
  readonly quantity: number;
}

/** The structured draft a paste resolves to. Everything is optional/best-effort. */
export interface ParsedDraft {
  readonly name: string | null;
  /** Normalized E.164 when a recognizable phone was found, else `null`. */
  readonly phone: string | null;
  readonly address: string | null;
  readonly items: ParsedItem[];
  /** Lines the parser could not classify — kept so nothing is silently dropped. */
  readonly notes: string | null;
}

/** Field labels understood in Arabic and English (case-insensitive). */
const LABELS = {
  name: /^(?:name|الاسم|اسم)\s*[:：-]\s*(.+)$/i,
  phone: /^(?:phone|mobile|tel|الهاتف|الموبايل|موبايل|رقم|تليفون)\s*[:：-]\s*(.+)$/i,
  address: /^(?:address|addr|العنوان|عنوان)\s*[:：-]\s*(.+)$/i,
};

/** `2 x Shirt`, `2× Shirt`, `Shirt x2`, `2 Shirt`, `٢ قميص` (Arabic-Indic digits). */
const ITEM_QTY_FIRST = /^(\d+)\s*(?:x|×|\*)?\s+(.{2,})$/i;
const ITEM_QTY_LAST = /^(.{2,}?)\s*(?:x|×|\*)\s*(\d+)$/i;

/** Convert Arabic-Indic (٠-٩) and Persian digits to ASCII so regexes match. */
function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Normalize an Egyptian / international phone to E.164, or return `null`. Kept
 * local to the parser (and duplicated from the customers module by design — the
 * modules must not import each other, `no-cross-feature-imports`): the customers
 * module owns the authoritative normalization for what it *stores*; this one only
 * decides whether a pasted token *looks* like a dialable number to pre-fill.
 */
export function normalizePhone(raw: string): string | null {
  const digits = toAsciiDigits(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    return /^\d{8,15}$/.test(rest) ? `+${rest}` : null;
  }
  // Egyptian mobile: 01x xxxx xxxx (11 digits) → +20 + last 10.
  if (/^01\d{9}$/.test(digits)) return `+20${digits.slice(1)}`;
  // 00-prefixed international.
  if (/^00\d{8,15}$/.test(digits)) return `+${digits.slice(2)}`;
  // Bare country-coded (e.g. 20xxxxxxxxxx).
  if (/^\d{10,15}$/.test(digits)) return `+${digits}`;
  return null;
}

/** Find the first phone-like token on a line and normalize it. */
function findPhone(line: string): string | null {
  const candidate = toAsciiDigits(line).match(/\+?\d[\d\s\-()]{7,}\d/);
  return candidate === null ? null : normalizePhone(candidate[0]);
}

/** Parse a single line into an item (`qty × name`), or `null` if it is not one. */
function parseItem(line: string): ParsedItem | null {
  const ascii = toAsciiDigits(line).trim();
  const first = ascii.match(ITEM_QTY_FIRST);
  if (first !== null) {
    return { name: first[2]!.trim(), quantity: clampQty(first[1]!) };
  }
  const last = ascii.match(ITEM_QTY_LAST);
  if (last !== null) {
    return { name: last[1]!.trim(), quantity: clampQty(last[2]!) };
  }
  return null;
}

function clampQty(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 1;
}

/** True for a line that is (almost) all digits/phone punctuation — a bare number. */
function looksLikePhoneLine(line: string): boolean {
  const ascii = toAsciiDigits(line).trim();
  return /^\+?[\d\s\-()]{8,}$/.test(ascii) && normalizePhone(ascii) !== null;
}

/**
 * Parse pasted text into a {@link ParsedDraft}. Deterministic and pure — the same
 * text always yields the same draft. Precedence: an explicit `label: value` wins
 * over a heuristic; a `qty × name` line becomes an item; a bare phone number sets
 * the phone; the longest remaining line is guessed as the address; the first
 * unclassified line is guessed as the name; everything left lands in `notes`.
 */
export function parsePaste(text: string): ParsedDraft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let name: string | null = null;
  let phone: string | null = null;
  let address: string | null = null;
  const items: ParsedItem[] = [];
  const leftovers: string[] = [];

  for (const line of lines) {
    const nameLabel = line.match(LABELS.name);
    if (nameLabel !== null) {
      name ??= nameLabel[1]!.trim();
      continue;
    }
    const phoneLabel = line.match(LABELS.phone);
    if (phoneLabel !== null) {
      phone ??= findPhone(phoneLabel[1]!);
      continue;
    }
    const addressLabel = line.match(LABELS.address);
    if (addressLabel !== null) {
      address ??= addressLabel[1]!.trim();
      continue;
    }
    if (looksLikePhoneLine(line)) {
      phone ??= findPhone(line);
      continue;
    }
    const item = parseItem(line);
    if (item !== null) {
      items.push(item);
      continue;
    }
    leftovers.push(line);
  }

  // Heuristics over what is left: the longest leftover is likely the address,
  // the first is likely the name. Both only fill a field the labels did not.
  if (leftovers.length > 0) {
    if (name === null) name = leftovers.shift() ?? null;
  }
  if (address === null && leftovers.length > 0) {
    const longest = [...leftovers].sort((a, b) => b.length - a.length)[0]!;
    address = longest;
    leftovers.splice(leftovers.indexOf(longest), 1);
  }

  return {
    name,
    phone,
    address,
    items,
    notes: leftovers.length > 0 ? leftovers.join("\n") : null,
  };
}
