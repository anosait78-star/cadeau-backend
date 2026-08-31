import { useLocation } from "react-router";
import { useNavItems } from "@/features/access/use-nav-items";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * Resolves the title of the current mobile screen from the navigation config,
 * so the shell can show *where you are* without every page having to declare it.
 *
 * The match is the longest destination that prefixes the current path, which
 * makes a nested route (`/settings/team`) resolve to its own destination when
 * one exists and otherwise inherit its parent's title (`/orders/42` → Orders).
 * `isRoot` is true only on the destination itself: root screens get the large
 * title, anything deeper gets a compact bar with a back control.
 */
export function useMobileRouteTitle(): { title: string; isRoot: boolean } {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const items = useNavItems();

  let best: { to: string; labelKey: Parameters<typeof t>[0] } | null = null;
  for (const item of items) {
    const matches =
      item.to === "/"
        ? pathname === "/"
        : pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (matches && (best === null || item.to.length > best.to.length)) {
      best = { to: item.to, labelKey: item.labelKey };
    }
  }

  if (best === null) return { title: t("app.name"), isRoot: pathname === "/" };
  return { title: t(best.labelKey), isRoot: pathname === best.to };
}
