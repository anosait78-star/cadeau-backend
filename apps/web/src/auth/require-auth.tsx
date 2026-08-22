import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { LoadingState } from "@/components/states/loading-state";
import { useCapabilities } from "@/features/access/use-capabilities";
import { useAuth } from "./use-auth";

/**
 * Route guard for the authenticated shell. While the session is still hydrating
 * it shows the standard loading state; once resolved, unauthenticated callers
 * are redirected to `/login` (preserving the attempted location so login can
 * return them). Authenticated callers with no company yet are redirected to
 * `/onboarding` (there is nothing for {@link AppShell} to render without an
 * active tenant) — *unless* they're a platform Super-Admin: that privilege is
 * company-independent (`platform_admins`, EPIC-5), so an admin account with no
 * tenant membership must still reach `/admin` instead of being stuck in
 * onboarding forever. A member whose role in the active company is `"vendor"`
 * (Vendor Accounts) is confined to `/vendor/*` — same {@link AppShell} as
 * everyone else (identical sidebar/topbar chrome), but `useNavItems` gives
 * them the short vendor-only destination list, since their permission
 * template is `inventory.read` only and the rest of the company shell's
 * routes would be forbidden/empty for them. Everyone else renders the nested
 * routes.
 */
export function RequireAuth(): ReactNode {
  const { status, user } = useAuth();
  const { status: capsStatus, isSuperAdmin } = useCapabilities();
  const location = useLocation();

  if (status === "loading" || (status === "authenticated" && capsStatus === "loading")) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (
    user !== null &&
    user.companies.length === 0 &&
    !isSuperAdmin &&
    !location.pathname.startsWith("/onboarding")
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // A Super-Admin with no tenant membership has nothing for the regular,
  // company-scoped shell (dashboard, orders, ...) to show — send them
  // straight to the platform admin surface instead of a broken/empty page.
  if (
    user !== null &&
    user.companies.length === 0 &&
    isSuperAdmin &&
    location.pathname !== "/admin"
  ) {
    return <Navigate to="/admin" replace />;
  }

  const activeRole = user?.companies.find((c) => c.id === user.activeCompanyId)?.role ?? null;
  if (activeRole === "vendor" && !location.pathname.startsWith("/vendor")) {
    return <Navigate to="/vendor" replace />;
  }

  return <Outlet />;
}
