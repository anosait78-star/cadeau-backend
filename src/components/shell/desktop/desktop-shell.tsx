import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopTopbar } from "./desktop-topbar";

/**
 * Desktop shell (ADR-002): fixed sidebar + top bar + scrollable content. This is
 * the independent power-user experience; the Mobile shell is a separate tree.
 * Command Palette (⌘K) and multi-column detail panes arrive in M2.2.
 */
export function DesktopShell(): ReactNode {
  return (
    <div className="flex h-full">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DesktopTopbar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
