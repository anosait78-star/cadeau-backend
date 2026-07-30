import type { ReactNode } from "react";
import { useCapabilities } from "@/features/access/use-capabilities";

/**
 * Renders its children only when the caller holds the named permission
 * (optionally also requiring a feature); otherwise renders `fallback` (nothing
 * by default). Client-side convenience only — the API enforces the same check
 * server-side (ADR-003).
 */
export function PermissionGate({
  permission,
  feature,
  fallback = null,
  children,
}: {
  permission: string;
  feature?: string;
  fallback?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const { has } = useCapabilities();
  return has(feature === undefined ? { permission } : { permission, feature })
    ? children
    : fallback;
}
