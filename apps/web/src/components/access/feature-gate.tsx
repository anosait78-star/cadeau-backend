import type { ReactNode } from "react";
import { useCapabilities } from "@/features/access/use-capabilities";

/**
 * Renders its children only when the named feature is enabled for the active
 * company; otherwise renders `fallback` (nothing by default). A client-side
 * convenience only — the API enforces the same check server-side (ADR-003).
 */
export function FeatureGate({
  feature,
  fallback = null,
  children,
}: {
  feature: string;
  fallback?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const { has } = useCapabilities();
  return has({ feature }) ? children : fallback;
}
