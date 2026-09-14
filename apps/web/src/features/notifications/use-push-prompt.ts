import { useCallback, useEffect, useState } from "react";
import { enablePush, getPushState, type PushState } from "./push";

/**
 * Whether to nudge this user to turn on push, and the action that does it.
 *
 * The nudge is ours, not the browser's. Calling `Notification.requestPermission`
 * unprompted is the one thing browsers punish hardest — a dismissed prompt can
 * cost the origin its permission for good — so nothing reaches the browser
 * until the user presses the button in our own banner.
 *
 * A device that cannot do push, or whose owner has already refused, is never
 * nudged: neither is something the banner could fix.
 */
export function usePushPrompt(): {
  /** True when this device could take push but is not subscribed. */
  readonly shouldPrompt: boolean;
  readonly state: PushState | null;
  readonly busy: boolean;
  /** Runs the real permission + subscribe flow. Resolves to where it ended. */
  readonly enable: () => Promise<PushState>;
  /** Hide the banner for now without touching any browser permission. */
  readonly dismiss: () => void;
} {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPushState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async (): Promise<PushState> => {
    setBusy(true);
    try {
      const next = await enablePush();
      setState(next);
      return next;
    } finally {
      setBusy(false);
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    shouldPrompt: !dismissed && state === "idle",
    state,
    busy,
    enable,
    dismiss,
  };
}

/** Session key for the once-per-sign-in nudge. */
const SESSION_KEY = "cadeau.pushPromptShown";

/**
 * Whether the sign-in nudge is still owed this session.
 *
 * Scoped to the tab's session rather than remembered for good, so the user is
 * asked again after each sign-in — as asked for — while a single working day
 * is not interrupted over and over. Storage can throw in a private window, so
 * a failure reads as "already shown" and stays quiet.
 */
export function claimSessionPushPrompt(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY) !== null) return false;
    sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
