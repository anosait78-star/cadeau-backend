import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * Account dropdown in the Desktop topbar. Items are placeholders until Auth
 * (EPIC-4) wires real profile/settings/sign-out actions.
 */
export function UserMenu(): ReactNode {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <UserRound className="h-4 w-4" aria-hidden="true" />
          <span>{t("user.account")}</span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("user.account")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <UserRound className="h-4 w-4" aria-hidden="true" />
          {t("user.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="h-4 w-4" aria-hidden="true" />
          {t("user.settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t("user.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
