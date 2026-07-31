/**
 * Retry/backoff policy for the webhook inbox (EPIC-12 M12.4, decision D2).
 * Pure data + functions — the repository persists what these compute, never
 * decides the schedule itself.
 */

/** 30s, doubling each attempt, capped at 1h. */
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** After this many failed attempts, the event is parked (no further retry). */
export const MAX_ATTEMPTS = 10;

/** Whether `attempts` has exhausted the retry budget. */
export function isRetryExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

/**
 * The next attempt time for a row that has failed `attempts` times, or `null`
 * when the retry budget is exhausted — a `null` `next_attempt_at` is never
 * `<= now()`, so the claim query naturally stops picking it up (parked, not
 * deleted; the row stays for inspection).
 */
export function computeNextAttempt(attempts: number, now: Date = new Date()): Date | null {
  if (isRetryExhausted(attempts)) return null;
  const delayMs = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  return new Date(now.getTime() + delayMs);
}
