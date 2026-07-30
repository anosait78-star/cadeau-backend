import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { LoadingState } from "@/components/states/loading-state";
import { useCapabilities } from "./use-capabilities";

/**
 * Route guard for the platform Super-Admin surface. While capabilities are
 * loading it shows a spinner; a non-admin is redirected home. This mirrors the
 * server-side `SuperAdminGuard` — the API is the real gate, this only keeps the
 * UI honest.
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }): ReactNode {
  const { status, isSuperAdmin } = useCapabilities();
  if (status === "loading") {
    return <LoadingState />;
  }
  if (!isSuperAdmin) {
    return <Navigate to="/" replace />;
  }
  return children;
}
