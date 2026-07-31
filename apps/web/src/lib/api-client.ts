import { clearTokens, readTokens, writeTokens } from "@/auth/auth-storage";

/**
 * The BFF base URL. Defaults to the local API (`/v1` prefix, port 3000) and is
 * overridable at build time via `VITE_API_BASE_URL` for staging/production.
 */
const BASE_URL = (import.meta.env["VITE_API_BASE_URL"] ?? "http://localhost:3000/v1").replace(
  /\/+$/,
  "",
);

/** A structured field error from the `VALIDATION_FAILED` envelope (§4). */
export interface FieldError {
  readonly field: string;
  readonly messages: string[];
}

/**
 * A non-2xx API response, decoded from the unified error envelope (§3). Clients
 * switch on {@link code} — never the HTTP status or the human message.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(args: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.statusCode = args.statusCode;
    this.details = args.details ?? null;
    this.requestId = args.requestId ?? null;
  }

  /** True when the server flagged that a TOTP code is required to complete login. */
  get twoFactorRequired(): boolean {
    return (
      this.statusCode === 401 &&
      typeof this.details === "object" &&
      this.details !== null &&
      (this.details as { twoFactorRequired?: unknown }).twoFactorRequired === true
    );
  }

  /** Field errors when this is a validation failure, else an empty array. */
  get fieldErrors(): FieldError[] {
    return Array.isArray(this.details) ? (this.details as FieldError[]) : [];
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Attach the bearer access token and refresh-and-retry on a 401. Default true. */
  auth?: boolean;
  signal?: AbortSignal;
  /** Extra request headers (e.g. `Idempotency-Key`), merged over the defaults. */
  headers?: Record<string, string>;
}

/** A single shared refresh so concurrent 401s trigger only one rotation. */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Typed fetch against the BFF. Decodes the success body (or `null` for 204) and
 * throws {@link ApiError} for the error envelope. Authenticated requests attach
 * the access token; on a `401 UNAUTHORIZED` (that is not a 2FA challenge) it
 * rotates the refresh token once and retries transparently.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, signal, headers: extraHeaders } = options;

  const send = async (accessToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken !== null) headers["Authorization"] = `Bearer ${accessToken}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal !== undefined) init.signal = signal;
    return fetch(`${BASE_URL}${path}`, init);
  };

  const initialToken = auth ? (readTokens()?.accessToken ?? null) : null;
  let response = await send(initialToken);

  if (auth && response.status === 401) {
    const decoded = await peekError(response);
    // A 2FA challenge is a real credential outcome, not an expired token — surface it.
    if (decoded !== null && isTwoFactorChallenge(decoded)) {
      throw toApiError(decoded, response.status);
    }
    const rotated = await refreshAccessToken();
    if (rotated !== null) {
      response = await send(rotated);
    } else if (decoded !== null) {
      throw toApiError(decoded, response.status);
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Fetch a binary response (e.g. a generated PDF) with the same bearer-token +
 * refresh-and-retry behavior as {@link apiFetch}, but returning a `Blob`
 * instead of decoding JSON. Used for authenticated file downloads.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const send = async (accessToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken !== null) headers["Authorization"] = `Bearer ${accessToken}`;
    return fetch(`${BASE_URL}${path}`, { method: "GET", headers });
  };

  const initialToken = readTokens()?.accessToken ?? null;
  let response = await send(initialToken);

  if (response.status === 401) {
    const decoded = await peekError(response);
    if (decoded !== null && isTwoFactorChallenge(decoded)) {
      throw toApiError(decoded, response.status);
    }
    const rotated = await refreshAccessToken();
    if (rotated !== null) {
      response = await send(rotated);
    } else if (decoded !== null) {
      throw toApiError(decoded, response.status);
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  return response.blob();
}

/** Rotate the access token using the stored refresh token; `null` on failure. */
async function refreshAccessToken(): Promise<string | null> {
  const current = readTokens();
  if (current === null) return null;

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        clearTokens();
        return null;
      }
      const tokens = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
      return writeTokens(tokens).accessToken;
    } catch {
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

interface RawErrorEnvelope {
  code?: string;
  message?: string;
  statusCode?: number;
  details?: unknown;
  requestId?: string | null;
}

/** Best-effort decode of the error envelope without consuming a needed body twice. */
async function peekError(response: Response): Promise<RawErrorEnvelope | null> {
  try {
    const json = (await response.clone().json()) as { error?: RawErrorEnvelope };
    return json.error ?? null;
  } catch {
    return null;
  }
}

function isTwoFactorChallenge(error: RawErrorEnvelope): boolean {
  return (
    typeof error.details === "object" &&
    error.details !== null &&
    (error.details as { twoFactorRequired?: unknown }).twoFactorRequired === true
  );
}

function toApiError(error: RawErrorEnvelope, fallbackStatus: number): ApiError {
  return new ApiError({
    code: error.code ?? "INTERNAL",
    message: error.message ?? "Request failed",
    statusCode: error.statusCode ?? fallbackStatus,
    details: error.details,
    requestId: error.requestId ?? null,
  });
}

async function parseError(response: Response): Promise<ApiError> {
  const decoded = await peekError(response);
  if (decoded !== null) return toApiError(decoded, response.status);
  return new ApiError({
    code: "INTERNAL",
    message: "Request failed",
    statusCode: response.status,
  });
}
