import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  switchCompany as switchCompanyRequest,
  type AuthResponse,
  type LoginInput,
  type MeView,
  type RegisterInput,
} from "./auth-api";
import { clearTokens, readTokens, writeTokens } from "./auth-storage";
import { AuthContext, type AuthContextValue, type AuthStatus } from "./auth-context";

/**
 * Owns the session: hydrates from stored tokens on mount (validating them via
 * `GET /v1/me`), exposes credential/registration/logout flows, and keeps the
 * `user` view fresh across tenant switches. Token rotation on expiry is handled
 * transparently by the API client; this provider tracks only the resolved state.
 */
export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<MeView | null>(null);

  const loadMe = useCallback(async (): Promise<void> => {
    const me = await getMe();
    setUser(me);
    setStatus("authenticated");
  }, []);

  // Hydrate once: if tokens exist, confirm them; otherwise we are signed out.
  useEffect(() => {
    let active = true;
    if (readTokens() === null) {
      setStatus("unauthenticated");
      return;
    }
    void (async () => {
      try {
        const me = await getMe();
        if (active) {
          setUser(me);
          setStatus("authenticated");
        }
      } catch {
        if (active) {
          clearTokens();
          setUser(null);
          setStatus("unauthenticated");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    async (input: LoginInput): Promise<AuthResponse> => {
      const result = await loginRequest(input);
      writeTokens(result);
      await loadMe();
      return result;
    },
    [loadMe],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthResponse> => {
      const result = await registerRequest(input);
      writeTokens(result);
      await loadMe();
      return result;
    },
    [loadMe],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutRequest();
    } catch {
      // Best-effort: revoke locally even if the server call fails.
    }
    clearTokens();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const switchCompany = useCallback(
    async (companyId: string): Promise<void> => {
      const tokens = await switchCompanyRequest(companyId);
      writeTokens(tokens);
      await loadMe();
    },
    [loadMe],
  );

  const reload = useCallback(async (): Promise<void> => {
    await loadMe();
  }, [loadMe]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, switchCompany, reload }),
    [status, user, login, register, logout, switchCompany, reload],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
