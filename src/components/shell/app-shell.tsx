import type { ReactNode } from "react";
import { useIsDesktop } from "@/hooks/use-media-query";
import { CommandPaletteProvider } from "@/providers/command-palette-provider";
import { DesktopShell } from "./desktop/desktop-shell";
import { MobileShell } from "./mobile/mobile-shell";

/**
 * Selects the independent shell for the current viewport (ADR-002): the Desktop
 * shell at ≥1024px, the Mobile shell below it. The two are separate component
 * trees, not one responsive layout. The command palette (⌘K) is available to
 * both (it lives inside the router here so it can navigate).
 */
export function AppShell(): ReactNode {
  const isDesktop = useIsDesktop();
  return (
    <CommandPaletteProvider>
      {isDesktop ? <DesktopShell /> : <MobileShell />}
    </CommandPaletteProvider>
  );
}
