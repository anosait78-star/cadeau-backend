import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/use-auth";
import { AppActions } from "@/components/shell/app-actions";
import { BottomSheet } from "@/components/ui/sheet";
import { useI18n } from "@/i18n/i18n-provider";
import { MOBILE_OVERFLOW } from "./mobile-bottom-nav";

/**
 * The "More" bottom sheet: the overflow navigation destinations plus the shared
 * actions (theme + language). Swipe down or tap outside to dismiss.
 */
export function MobileMoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { t } = useI18n();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const go = (to: string): void => {
    onOpenChange(false);
    void navigate(to);
  };

  const onSignOut = (): void => {
    onOpenChange(false);
    void logout();
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={t("nav.more")}>
      <div className="flex flex-col gap-1">
        {MOBILE_OVERFLOW.map(({ to, labelKey, icon: Icon }) => (
          <button
            key={to}
            type="button"
            onClick={() => go(to)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-border" />
      <AppActions />
      <div className="my-3 h-px bg-border" />
      <button
        type="button"
        onClick={onSignOut}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-destructive hover:bg-muted"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span>{t("user.signOut")}</span>
      </button>
    </BottomSheet>
  );
}
