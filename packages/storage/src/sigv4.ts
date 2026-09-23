import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 — the subset S3-compatible object stores need
 * (EPIC-17 · M17.3).
 *
 * Self-built on `node:crypto`, the same posture `@cadeau/crypto` takes for JWT
 * and AES-GCM: SigV4 is a fully specified, deterministic algorithm, and
 * implementing it here keeps a vendor SDK and its transitive tree out of the
 * dependency surface (Engineering Standards §5.1, "تقليل السطح"). Verified
 * against AWS's own published test vectors in `sigv4.test.ts`.
 *
 * Two signing modes are covered:
 *   - `signRequest` — an `Authorization` header, for requests we make (PUT).
 *   - `presignUrl`  — a query-signed URL, for a browser to GET directly.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";

/** The long-lived credentials a signer needs. */
export interface SigV4Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Set for temporary (STS) credentials; folded into the signature when present. */
  readonly sessionToken?: string;
  readonly region: string;
}

/** A request to sign with an `Authorization` header. */
export interface SignRequestInput {
  readonly method: string;
  /** Absolute URL, already including any query string. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Raw body bytes; empty for a bodyless request. */
  readonly body?: Buffer;
  /** Injectable for deterministic tests; defaults to now. */
  readonly now?: Date;
}

/** A URL to sign in its query string, for a third party to fetch directly. */
export interface PresignInput {
  readonly method: string;
  readonly url: string;
  /** How long the URL stays valid, in seconds (1…604800, the SigV4 ceiling). */
  readonly expiresInSeconds: number;
  readonly now?: Date;
}

/** The SigV4 ceiling on a presigned URL's lifetime: seven days. */
export const MAX_PRESIGN_SECONDS = 604800;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** `20260923T014530Z` and `20260923` — the two timestamp forms SigV4 uses. */
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Percent-encode per RFC 3986, which is stricter than `encodeURIComponent`:
 * it leaves `!'()*` alone, and SigV4 requires them encoded. Object keys reach
 * this function, so a key with a space or a quote must not break the signature.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const char of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(char);
    if (/[A-Za-z0-9\-._~]/.test(c)) {
      out += c;
    } else if (c === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      out += `%${char.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * The canonical path: each segment encoded, slashes kept as separators.
 *
 * `URL` has already percent-encoded parts of `pathname` (a space arrives as
 * `%20`), and encoding that again would turn its `%` into `%25` and sign a
 * path nobody asked for. So each segment is decoded back to its literal
 * characters first, then encoded once under SigV4's stricter rules. A segment
 * holding a stray `%` is not valid percent-encoding and is left as-is rather
 * than throwing.
 */
function canonicalPath(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  return pathname
    .split("/")
    .map((segment) => uriEncode(decodeSegment(segment)))
    .join("/");
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Query parameters sorted by name, then value — SigV4's canonical order. */
function canonicalQuery(params: URLSearchParams): string {
  const pairs: [string, string][] = [];
  params.forEach((value, key) => pairs.push([uriEncode(key), uriEncode(value)]));
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * Header names lowercased, values whitespace-collapsed, sorted by name.
 * Returns both the canonical block and the `;`-joined list of signed names.
 */
function canonicalHeaders(headers: Readonly<Record<string, string>>): {
  block: string;
  signed: string;
} {
  const normalized = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase().trim(), v.replace(/\s+/g, " ").trim()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    block: normalized.map(([k, v]) => `${k}:${v}\n`).join(""),
    signed: normalized.map(([k]) => k).join(";"),
  };
}

/** The chained per-request signing key: date → region → service → "aws4_request". */
function signingKey(credentials: SigV4Credentials, dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, credentials.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function credentialScope(dateStamp: string, region: string): string {
  return `${dateStamp}/${region}/${SERVICE}/aws4_request`;
}

/** The string-to-sign, given an already-built canonical request. */
function stringToSign(amzDate: string, scope: string, canonicalRequest: string): string {
  return [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
}

/** A signed request: fetch exactly this URL with exactly these headers. */
export interface SignedRequest {
  /**
   * The URL spelled the way it was signed, which is not always the way `URL`
   * would print it — send this one, not the input.
   */
  readonly url: string;
  readonly headers: Record<string, string>;
}

/**
 * Sign a request, returning the URL and headers to send — the caller's own
 * headers plus `Authorization`, `x-amz-date` and `x-amz-content-sha256`.
 *
 * `Host` is always signed: without it a captured signature could be replayed
 * against a different endpoint.
 */
export function signRequest(credentials: SigV4Credentials, input: SignRequestInput): SignedRequest {
  const url = new URL(input.url);
  const { amzDate, dateStamp } = stamps(input.now ?? new Date());
  const body = input.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    ...input.headers,
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken !== undefined) {
    headers["x-amz-security-token"] = credentials.sessionToken;
  }

  const { block, signed } = canonicalHeaders(headers);
  const path = canonicalPath(url.pathname);
  const query = canonicalQuery(url.searchParams);
  const canonicalRequest = [
    input.method.toUpperCase(),
    path,
    query,
    block,
    signed,
    payloadHash,
  ].join("\n");

  const scope = credentialScope(dateStamp, credentials.region);
  const signature = hmac(
    signingKey(credentials, dateStamp),
    stringToSign(amzDate, scope, canonicalRequest),
  ).toString("hex");

  return {
    // Built from the signed spelling, for the same reason `presignUrl` is.
    url: query === "" ? `${url.origin}${path}` : `${url.origin}${path}?${query}`,
    headers: {
      ...headers,
      Authorization:
        `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signed}, Signature=${signature}`,
    },
  };
}

/**
 * Build a URL that carries its own signature, for handing to a browser.
 *
 * Only `host` is signed, because a browser sends nothing else we control; the
 * payload is the literal `UNSIGNED-PAYLOAD`, which is what S3 expects for a
 * presigned GET.
 */
export function presignUrl(credentials: SigV4Credentials, input: PresignInput): string {
  if (
    !Number.isInteger(input.expiresInSeconds) ||
    input.expiresInSeconds < 1 ||
    input.expiresInSeconds > MAX_PRESIGN_SECONDS
  ) {
    throw new RangeError(`expiresInSeconds must be an integer in 1…${MAX_PRESIGN_SECONDS}.`);
  }

  const url = new URL(input.url);
  const { amzDate, dateStamp } = stamps(input.now ?? new Date());
  const scope = credentialScope(dateStamp, credentials.region);

  url.searchParams.set("X-Amz-Algorithm", ALGORITHM);
  url.searchParams.set("X-Amz-Credential", `${credentials.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(input.expiresInSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  if (credentials.sessionToken !== undefined) {
    url.searchParams.set("X-Amz-Security-Token", credentials.sessionToken);
  }

  const { block, signed } = canonicalHeaders({ host: url.host });
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    block,
    signed,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const signature = hmac(
    signingKey(credentials, dateStamp),
    stringToSign(amzDate, scope, canonicalRequest),
  ).toString("hex");

  // Rebuild the URL from the exact strings that went into the signature
  // rather than returning `url.toString()`. The two encodings differ — `URL`
  // leaves `(`, `)` and `!` literal where SigV4 requires them escaped — and a
  // URL that is spelled differently from what was signed only works if the
  // server happens to re-canonicalize it the same way. Emitting the signed
  // spelling removes that dependency.
  const query = canonicalQuery(url.searchParams);
  return `${url.origin}${canonicalPath(url.pathname)}?${query}&X-Amz-Signature=${signature}`;
}
