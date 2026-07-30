/**
 * Token persistence. The access + refresh pair lives in `localStorage` so a
 * reload keeps the session; the API client reads it on every request and rotates
 * it on refresh. Access tokens are short-lived (minutes) and refresh tokens are
 * rotated on every use with server-side reuse detection (M4.3), so this is the
 * pragmatic storage for a self-hosted SPA with no cookie/BFF split.
 */
const STORAGE_KEY = "cadeau.auth.tokens";

/** The persisted token pair plus the absolute expiry of the access token. */
export interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  readonly expiresAt: number;
}

/** Read the stored token pair, or `null` when signed out / malformed. */
export function readTokens(): StoredTokens | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (
      typeof parsed.accessToken === "string" &&
      typeof parsed.refreshToken === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
      };
    }
  } catch {
    // Fall through to clear the corrupt entry.
  }
  localStorage.removeItem(STORAGE_KEY);
  return null;
}

/** Persist a token pair, deriving the absolute expiry from `expiresIn` seconds. */
export function writeTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): StoredTokens {
  const stored: StoredTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

/** Forget the session (sign-out, or an unrecoverable refresh failure). */
export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEY);
}
