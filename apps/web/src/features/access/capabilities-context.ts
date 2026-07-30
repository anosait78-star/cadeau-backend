import { createContext } from "react";

/** Lifecycle of the capability set: unknown while loading, then a definite state. */
export type CapabilitiesStatus = "loading" | "ready" | "unauthenticated";

/** What a gate/route/menu requires. Both optional; both must hold when present. */
export interface CapabilityRequirement {
  readonly feature?: string;
  readonly permission?: string;
}

export interface CapabilitiesContextValue {
  readonly status: CapabilitiesStatus;
  readonly features: string[];
  readonly permissions: string[];
  readonly isSuperAdmin: boolean;
  /** Whether the caller satisfies a requirement (feature AND permission when given). */
  has: (requirement: CapabilityRequirement) => boolean;
  /** Re-fetch capabilities (e.g. after an access change). */
  reload: () => Promise<void>;
}

export const CapabilitiesContext = createContext<CapabilitiesContextValue | undefined>(undefined);
