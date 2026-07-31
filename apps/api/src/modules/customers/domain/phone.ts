/**
 * Phone normalization for the customers module (EPIC-10).
 *
 * The phone number is the customer's identity key: it carries a unique index and
 * it is the only way a customer can be looked up. Because the stored form is a
 * **blind index** (an HMAC of the value — see `docs/privacy-model.md`), the hash
 * is only as reliable as the normalization in front of it: `"+20 100 123 4567"`
 * and `"+201001234567"` hash differently, so a sloppy normalizer silently lets a
 * duplicate through the unique index it was supposed to trip.
 *
 * That is why normalization lives **here**, in one function, used by writes and
 * lookups alike — never inlined at a call site.
 */

/** Digits allowed after the `+` in E.164 (ITU-T: 1–15, minimum sane length 8). */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** Characters humans put in phone numbers that carry no information. */
const NOISE = /[\s\-().]/g;

/**
 * Normalize a caller-supplied phone number to E.164 (`+` followed by digits), or
 * return `null` if it cannot be one.
 *
 * Accepted inputs:
 *   - `+201001234567`      → `+201001234567`
 *   - `+20 100 123 4567`   → `+201001234567`  (noise stripped)
 *   - `00201001234567`     → `+201001234567`  (international access code)
 *
 * **Rejected — deliberately:** a bare national number such as `01001234567`.
 * Interpreting it requires knowing the tenant's country, and a company has no
 * country setting yet (EPIC-7 seeds `country_configs` as system reference data,
 * but nothing links a company to one). Guessing a country code here would mean
 * silently creating customers under the wrong number, so v1 asks the caller for
 * the country code instead. Wiring a per-company default country is an additive
 * change once that setting exists.
 */
export function normalizeE164(raw: string): string | null {
  const trimmed = raw.replace(NOISE, "");
  if (trimmed.length === 0) return null;

  let digits: string;
  if (trimmed.startsWith("+")) {
    digits = trimmed.slice(1);
  } else if (trimmed.startsWith("00")) {
    digits = trimmed.slice(2);
  } else {
    // A bare national number — see the note above.
    return null;
  }

  if (!/^[0-9]+$/.test(digits)) return null;
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  // E.164 country codes never start with 0.
  if (digits.startsWith("0")) return null;

  return `+${digits}`;
}

/** True when `raw` normalizes to a valid E.164 number. */
export function isE164Like(raw: string): boolean {
  return normalizeE164(raw) !== null;
}

/**
 * Mask a normalized E.164 number for a list response: keep the country code and
 * the last four digits, hide the middle (`+201001234567` → `+2010•••4567`).
 *
 * This limits what a *response* exposes, not what the server reads: producing the
 * mask still requires decrypting the row. The saving is in blast radius — a
 * leaked list page, a screenshot, a proxy log — not in work avoided.
 */
export function maskPhone(e164: string): string {
  const tail = e164.slice(-4);
  const head = e164.slice(0, Math.max(0, e164.length - 4));
  // Show at most the first 5 characters of the head (`+` + up to 4 digits).
  const shown = head.slice(0, 5);
  return `${shown}•••${tail}`;
}
