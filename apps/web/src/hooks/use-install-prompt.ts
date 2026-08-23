import { useCallback, useSyncExternalStore } from "react";

/**
 * The non-standard event Chromium fires when the app meets the installability
 * criteria (manifest + service worker + HTTPS/localhost). It is not in TS's DOM
 * lib, so it is declared here.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

/**
 * Whether an "install this app" affordance should be offered:
 *
 * - `available` — the browser handed us an install prompt we can trigger.
 * - `manual`    — iOS/iPadOS Safari, which never fires the prompt: the user
 *                 installs through Share → Add to Home Screen, so we can only
 *                 show instructions.
 * - `installed` — already installed (running standalone, or just installed).
 * - `unavailable` — nothing to offer (unsupported browser, or the prompt was
 *                 already used this page load).
 */
export type InstallAvailability = "available" | "manual" | "installed" | "unavailable";

/**
 * The display modes an installed app runs in. A page opened in a browser tab
 * matches `browser` instead, which is how "already installed" is detected on
 * every platform that supports installation.
 */
const STANDALONE_DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui"] as const;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let listening = false;
const subscribers = new Set<() => void>();

function emit(): void {
  for (const notify of subscribers) notify();
}

/** True when this page is running as an installed app rather than a browser tab. */
function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    for (const mode of STANDALONE_DISPLAY_MODES) {
      if (window.matchMedia(`(display-mode: ${mode})`).matches) return true;
    }
  }
  // iOS Safari predates `display-mode` and exposes its own flag instead.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iOS and iPadOS — every browser there is Safari underneath, and none fires `beforeinstallprompt`. */
function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop Mac UA; the touch points give it away.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

function currentAvailability(): InstallAvailability {
  if (installed || isRunningStandalone()) return "installed";
  if (deferredPrompt !== null) return "available";
  if (isIosDevice()) return "manual";
  return "unavailable";
}

/**
 * Starts listening at module load, not on mount: `beforeinstallprompt` can fire
 * before React has rendered, and a missed event cannot be recovered.
 */
function startListening(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress the browser's own mini-infobar so the in-app button is the one
    // affordance, then keep the event for when the button is pressed.
    event.preventDefault();
    deferredPrompt = event;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    installed = true;
    deferredPrompt = null;
    emit();
  });
}

startListening();

function subscribe(notify: () => void): () => void {
  startListening();
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

/** Server snapshot (never rendered on a server today, but `useSyncExternalStore` requires one). */
function serverAvailability(): InstallAvailability {
  return "unavailable";
}

/**
 * Triggers the browser's install dialog. Resolves with the user's choice, or
 * `unavailable` when there was no prompt to show.
 *
 * A captured prompt is single-use — the browser rejects a second `prompt()` on
 * the same event — so it is dropped as soon as it is spent, which is what makes
 * the button disappear after use. Chromium hands out a fresh one on a later
 * visit if the app is still not installed.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredPrompt;
  if (event === null) return "unavailable";

  deferredPrompt = null;
  emit();

  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") {
    // `appinstalled` follows, but hiding the button immediately keeps the UI honest.
    installed = true;
    emit();
  }
  return outcome;
}

/**
 * Clears the captured prompt and the installed flag. Exported for tests: the
 * store is module-level, so without this it would leak between them.
 */
export function resetInstallPromptState(): void {
  deferredPrompt = null;
  installed = false;
  emit();
}

/**
 * Reports whether the app can be installed on this device, and how. Backed by a
 * module-level store so every mounted consumer sees the same state and none of
 * them can miss the one-shot `beforeinstallprompt` event.
 */
export function useInstallAvailability(): InstallAvailability {
  return useSyncExternalStore(subscribe, currentAvailability, serverAvailability);
}

/** `useInstallAvailability` plus the action that shows the browser's install dialog. */
export function useInstallPrompt(): {
  readonly availability: InstallAvailability;
  readonly install: () => Promise<"accepted" | "dismissed" | "unavailable">;
} {
  const availability = useInstallAvailability();
  const install = useCallback(() => promptInstall(), []);
  return { availability, install };
}
