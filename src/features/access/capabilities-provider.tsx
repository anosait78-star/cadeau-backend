import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/use-auth";
import { getCapabilities } from "./access-api";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilitiesStatus,
  type CapabilityRequirement,
} from "./capabilities-context";

/**
 * Loads and exposes the caller's effective capabilities from
 * `GET /v1/access/capabilities`. Re-fetches whenever the session becomes
 * authenticated or the active tenant changes (a company switch re-issues tokens
 * and reloads `/v1/me`), so gates reflect the current tenant. The server is the
 * authority — these client capabilities only hide UI the API would refuse; every
 * request is still enforced server-side (ADR-003).
 */
export function CapabilitiesProvider({ children }: { children: ReactNode }): ReactNode {
  const { status: authStatus, user } = useAuth();
  const [status, setStatus] = useState<CapabilitiesStatus>("loading");
  const [features, setFeatures] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const activeCompanyId = user?.activeCompanyId ?? null;

  const load = useCallback(async (): Promise<void> => {
    const caps = await getCapabilities();
    setFeatures(caps.features);
    setPermissions(caps.permissions);
    setIsSuperAdmin(caps.isSuperAdmin);
    setStatus("ready");
  }, []);

  useEffect(() => {
    if (authStatus === "loading") {
      setStatus("loading");
      return;
    }
    if (authStatus === "unauthenticated") {
      setFeatures([]);
      setPermissions([]);
      setIsSuperAdmin(false);
      setStatus("unauthenticated");
      return;
    }
    let active = true;
    setStatus("loading");
    void (async () => {
      try {
        const caps = await getCapabilities();
        if (active) {
          setFeatures(caps.features);
          setPermissions(caps.permissions);
          setIsSuperAdmin(caps.isSuperAdmin);
          setStatus("ready");
        }
      } catch {
        if (active) {
          setFeatures([]);
          setPermissions([]);
          setIsSuperAdmin(false);
          setStatus("ready");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authStatus, activeCompanyId]);

  const has = useCallback(
    (requirement: CapabilityRequirement): boolean => {
      if (requirement.feature !== undefined && !features.includes(requirement.feature)) {
        return false;
      }
      if (requirement.permission !== undefined && !permissions.includes(requirement.permission)) {
        return false;
      }
      return true;
    },
    [features, permissions],
  );

  const value = useMemo<CapabilitiesContextValue>(
    () => ({ status, features, permissions, isSuperAdmin, has, reload: load }),
    [status, features, permissions, isSuperAdmin, has, load],
  );

  return <CapabilitiesContext value={value}>{children}</CapabilitiesContext>;
}
