import { ChevronDown, ChevronRight, Crown, Globe, LogOut, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/use-auth";
import { InstallAppButton } from "@/components/shell/install-app-button";
import { BottomSheet } from "@/components/ui/sheet";
import { useNavItems } from "@/features/access/use-nav-items";
import { initials, roleName } from "@/features/team/role-appearance";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { useTheme } from "@/providers/theme-provider";
import { MOBILE_PRIMARY_COUNT } from "./mobile-bottom-nav";

/**
 * Per-destination appearance for the drawer rows: a subtitle and the tint of the
 * icon tile. Keyed by route, not by label, because the route is the stable
 * identity of a destination (`useNavItems` may rename or re-gate labels).
 *
 * The tints are drawn from the app's semantic tokens rather than literal colours
 * so they invert with the theme, and each destination keeps the hue it already
 * has elsewhere in the product (finance is `info` blue, analytics `success`
 * green, master data `violet`, team `warning` amber, inventory the brand red).
 * A destination missing from the map still renders — it just gets no subtitle
 * and the neutral tile — so a nav item added later never disappears from here.
 */
const ROW_APPEARANCE: Readonly<
  Record<string, { readonly descriptionKey: TranslationKey; readonly tint: string }>
> = {
  "/": { descriptionKey: "nav.desc.dashboard", tint: "bg-primary/10 text-primary" },
  "/orders": { descriptionKey: "nav.desc.orders", tint: "bg-primary/10 text-primary" },
  "/customers": { descriptionKey: "nav.desc.customers", tint: "bg-info/10 text-info" },
  "/products": { descriptionKey: "nav.desc.products", tint: "bg-violet/10 text-violet" },
  "/inventory": { descriptionKey: "nav.desc.inventory", tint: "bg-primary/10 text-primary" },
  "/messages": { descriptionKey: "nav.desc.messages", tint: "bg-info/10 text-info" },
  "/finance": { descriptionKey: "nav.desc.finance", tint: "bg-info/10 text-info" },
  "/analytics": { descriptionKey: "nav.desc.analytics", tint: "bg-success/10 text-success" },
  "/master-data": { descriptionKey: "nav.desc.masterData", tint: "bg-violet/10 text-violet" },
  "/settings/team": { descriptionKey: "nav.desc.team", tint: "bg-warning/10 text-warning" },
  "/settings": { descriptionKey: "nav.desc.settings", tint: "bg-muted text-muted-foreground" },
  "/admin": { descriptionKey: "nav.desc.admin", tint: "bg-destructive/10 text-destructive" },
};

const NEUTRAL_TINT = "bg-muted text-muted-foreground";

/**
 * The "More" navigation drawer: a bottom sheet holding the identity card, the
 * overflow navigation destinations, and the shared preferences (theme +
 * language) above sign-out. Swipe down or tap outside to dismiss.
 *
 * The destinations still come from {@link useNavItems}, so the capability gates
 * (EPIC-5 feature/permission filtering) and the vendor list apply unchanged —
 * this file only decides how a row *looks*, never whether it exists.
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
  const overflow = useNavItems().slice(MOBILE_PRIMARY_COUNT);

  const go = (to: string): void => {
    onOpenChange(false);
    void navigate(to);
  };

  const onSignOut = (): void => {
    onOpenChange(false);
    void logout();
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={t("nav.more")} hideTitle>
      <UserCard />
      <div className="mt-3 flex flex-col gap-2">
        {overflow.map(({ to, labelKey, icon: Icon }) => {
          const appearance = ROW_APPEARANCE[to];
          return (
            <button
              key={to}
              type="button"
              onClick={() => go(to)}
              className="pressable touch-target flex w-full items-center gap-3 rounded-2xl bg-muted/40 px-3 py-3 text-start transition-colors hover:bg-muted"
            >
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl",
                  appearance?.tint ?? NEUTRAL_TINT,
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {t(labelKey)}
                </span>
                {appearance !== undefined ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {t(appearance.descriptionKey)}
                  </span>
                ) : null}
              </span>
              {/* Points along the reading direction: right in LTR, flipped in RTL. */}
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180"
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <div className="my-4 h-px bg-border" />
      <DrawerPreferences />
      <button
        type="button"
        onClick={onSignOut}
        className="pressable touch-target mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-3 py-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span>{t("user.signOut")}</span>
      </button>
    </BottomSheet>
  );
}

/**
 * The identity card at the head of the drawer: who is signed in, in which role,
 * and which product they are in. The product name/tagline sit here rather than
 * in a title bar because the drawer is the only mobile surface with room for
 * them — the top bar is reserved for the current screen.
 */
function UserCard(): ReactNode {
  const { t } = useI18n();
  const { user } = useAuth();

  const email = user?.email ?? "";
  const name = user?.fullName ?? (email.length > 0 ? email : t("user.account"));
  const activeRole =
    user?.companies.find((company) => company.id === user.activeCompanyId)?.role ?? null;

  return (
    <div className="rounded-2xl bg-primary/10 p-4">
      <div className="flex items-center gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/15 text-base font-bold text-primary"
          aria-hidden="true"
        >
          {initials(user?.fullName ?? null, email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-foreground">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {activeRole === null ? email : roleName(activeRole, t)}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
          <Crown className="h-3 w-3" aria-hidden="true" />
          {t("user.badge.premium")}
        </span>
      </div>
      <div className="mt-3 border-t border-primary/20 pt-3">
        <p className="text-xs font-semibold text-foreground">{t("app.name")}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t("app.tagline")}</p>
      </div>
    </div>
  );
}

/**
 * The drawer's preferences row: dark mode as a switch (a persistent setting, so
 * it reads as state rather than as an action) and the language as a picker.
 * Install-the-app stays here too and removes itself once installed.
 */
function DrawerPreferences(): ReactNode {
  const { t, toggleLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          onClick={toggleTheme}
          aria-label={t("actions.toggleTheme")}
          className="pressable touch-target flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
        >
          {isDark ? (
            <Sun className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-start font-medium text-foreground">
            {t("nav.menu.darkMode")}
          </span>
          {/* A drawn switch rather than a checkbox: the sheet needs it to match
              the surrounding rounded cards, and the token tints keep it themed. */}
          <span
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors",
              isDark ? "bg-primary" : "bg-border",
            )}
            aria-hidden="true"
          >
            <span
              className={cn(
                "absolute top-0.5 size-4 rounded-full bg-card transition-[inset-inline-start] duration-200",
                isDark ? "start-[1.125rem]" : "start-0.5",
              )}
            />
          </span>
        </button>
        <button
          type="button"
          onClick={toggleLocale}
          className="pressable touch-target flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
        >
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-start font-medium text-foreground">
            {t("actions.toggleLanguage")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
      <InstallAppButton />
    </div>
  );
}
