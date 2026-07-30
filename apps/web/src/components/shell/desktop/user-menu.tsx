import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/use-auth";
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
 * Account dropdown in the Desktop topbar. Shows the signed-in identity and wires
 * sign-out to the auth flow (revokes the session, then the route guard redirects
 * to /login). Profile/settings destinations arrive with later epics.
 */
export function UserMenu(): ReactNode {
  const { t } = useI18n();
  const { user, logout } = useAuth();

  const label = user?.fullName ?? user?.email ?? t("user.account");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <UserRound className="h-4 w-4" aria-hidden="true" />
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user?.email ?? t("user.account")}</DropdownMenuLabel>
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
        <DropdownMenuItem className="text-destructive" onSelect={() => void logout()}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t("user.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
