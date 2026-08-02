import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { LoadingState } from "@/components/states/loading-state";
import { useAuth } from "./use-auth";

/**
 * Route guard for the authenticated shell. While the session is still hydrating
 * it shows the standard loading state; once resolved, unauthenticated callers
 * are redirected to `/login` (preserving the attempted location so login can
 * return them). Authenticated callers with no company yet are redirected to
 * `/onboarding` (there is nothing for {@link AppShell} to render without an
 * active tenant); everyone else renders the nested routes.
 */
export function RequireAuth(): ReactNode {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") {
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
    !location.pathname.startsWith("/onboarding")
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
