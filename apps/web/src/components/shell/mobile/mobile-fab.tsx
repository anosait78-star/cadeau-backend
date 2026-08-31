import type { ReactNode } from "react";
import { useMobilePrimaryAction } from "./mobile-header-context";

/**
 * Floating action button (Mobile). It carries the **create** action of the
 * screen on display — the iOS/Material convention — which screens register with
 * `useRegisterMobilePrimaryAction`. A screen with nothing to create renders no
 * FAB rather than a button with no purpose; search lives in the header, which is
 * where a phone user looks for it.
 *
 * Anchored above the bottom nav by `.mobile-above-nav`, which is safe-area aware
 * and logical, so it mirrors in RTL.
 */
export function MobileFab(): ReactNode {
  const action = useMobilePrimaryAction();
  if (action === null) return null;

  const Icon = action.icon;
  return (
    <button
      type="button"
      onClick={action.onAction}
      aria-label={action.label}
      className="pressable mobile-above-nav fixed z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
