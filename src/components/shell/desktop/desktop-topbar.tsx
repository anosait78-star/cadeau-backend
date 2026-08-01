import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { AppActions } from "@/components/shell/app-actions";
import { CompanySwitcher } from "@/components/shell/company-switcher";
import { NotificationBell } from "@/components/shell/notification-bell";
import { CommandTrigger } from "./command-trigger";
import { UserMenu } from "./user-menu";

/** Desktop top bar: command palette trigger (start) + company switcher + shared actions + notifications + account menu (end). */
export function DesktopTopbar(): ReactNode {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <CommandTrigger />
      <div className="flex items-center gap-3">
        <CompanySwitcher />
        <AppActions />
        <FeatureGate feature="notifications">
          <NotificationBell />
        </FeatureGate>
        <UserMenu />
      </div>
    </header>
  );
}
