/**
 * VAT arithmetic for invoice issue (EPIC-13, M13.4, D3). Integer minor units
 * throughout, round-half-up to the minor unit (api-conventions §12.1) —
 * never floats.
 */

/**
 * `vatMinor = round_half_up(subtotalMinor * vatRateBps / 10000)`.
 *
 * BigInt-only arithmetic: adding half the divisor (`5000` when dividing by
 * `10000`) before an integer (truncating) division turns it into round-half-up
 * for non-negative operands, which is all this domain ever produces
 * (`subtotalMinor >= 0`, `vatRateBps` in `[0, 10000]`).
 */
export function computeVatMinor(subtotalMinor: bigint, vatRateBps: number): bigint {
  return (subtotalMinor * BigInt(vatRateBps) + 5000n) / 10000n;
}
