/**
 * Shared cross-feature contract: an issued access + refresh token pair. Lives in
 * `shared/contracts` (not inside the auth feature) so other features can depend
 * on the shape without importing the auth slice directly (architecture rule
 * `no-cross-feature-imports`). Pure data — no framework or IO coupling.
 */
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Access-token lifetime in seconds (for the `expires_in` response field). */
  readonly expiresInSeconds: number;
}
