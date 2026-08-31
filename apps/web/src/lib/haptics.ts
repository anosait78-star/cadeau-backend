/** The three things the UI ever needs to say through the vibration motor. */
export type HapticPattern = "tap" | "impact" | "error";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  /** A tab change, a selection — the lightest possible confirmation. */
  tap: 10,
  /** A sheet opening, a gesture committing — slightly more body. */
  impact: 15,
  /** A rejected action: two short pulses, felt as "no". */
  error: [12, 40, 12],
};

/**
 * Fire a haptic pulse, if the device has a vibration motor the browser exposes.
 *
 * Coverage is uneven by design of the platforms — Android/Chrome supports the
 * Vibration API, iOS Safari does not expose it at all — so this is *additive*
 * feedback only: every interaction it accompanies must already be legible from
 * the visuals alone. Silently does nothing where unsupported, and never throws
 * (some browsers reject a vibration outside a user gesture).
 */
export function haptic(pattern: HapticPattern): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // A blocked vibration is never worth failing an interaction over.
  }
}
