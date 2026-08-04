import { Logger } from "@nestjs/common";
import type { BostaHttpClientPort } from "../domain/bosta-http-client.port";
import {
  CarrierAuthError,
  CarrierRejectedError,
  CarrierUnavailableError,
} from "../domain/shipping.errors";

/** A single outbound Bosta call times out after this long. */
const TIMEOUT_MS = 10_000;

const CARRIER = "bosta";

/** Best-effort extraction of Bosta's own error wording from a non-2xx body. */
function extractMessage(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { message?: unknown; errorMessage?: unknown };
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.errorMessage === "string"
          ? parsed.errorMessage
          : null;
    return message !== null && message.length > 0 ? message : null;
  } catch {
    return rawBody.length > 0 ? rawBody : null;
  }
}

/**
 * Minimal `fetch` + timeout wrapper for Bosta's REST API — the first outbound
 * HTTP integration in this codebase (there is no existing client to reuse).
 * Deliberately thin: no retry-on-failure here (retries belong to the
 * webhook-inbox/retry-worker path for inbound events; outbound calls fail
 * fast and the caller decides whether to surface or retry at a higher level).
 *
 * Every non-2xx/network failure is mapped to a typed domain error — 401/403
 * become {@link CarrierAuthError} (the key is bad); a reached-but-refused
 * 4xx becomes {@link CarrierRejectedError} carrying Bosta's own message
 * verbatim (e.g. "cannot cancel a delivered shipment" — a business
 * rejection the caller should show the user as-is, not summarize); timeout,
 * network failure, or a 5xx becomes {@link CarrierUnavailableError} — so
 * `ShippingService` never has to know an HTTP status came from Bosta.
 */
export class BostaHttpClient implements BostaHttpClientPort {
  private readonly logger = new Logger(BostaHttpClient.name);

  constructor(private readonly baseUrl: string) {}

  /** `apiKey` is omitted for Bosta's public, unauthenticated endpoints (e.g. `/cities`). */
  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    apiKey?: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          ...(apiKey !== undefined ? { Authorization: apiKey } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      throw new CarrierUnavailableError(
        CARRIER,
        error instanceof Error && error.name === "AbortError"
          ? "Bosta did not respond in time."
          : "Could not reach Bosta.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new CarrierAuthError(CARRIER);
    }
    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      this.logger.error(`Bosta ${method} ${path} returned ${response.status}: ${rawBody}`);
      const message = extractMessage(rawBody);
      if (response.status >= 400 && response.status < 500) {
        throw new CarrierRejectedError(
          CARRIER,
          message ?? `Bosta rejected the request (${response.status}).`,
        );
      }
      throw new CarrierUnavailableError(CARRIER, message ?? `Bosta returned ${response.status}.`);
    }
    return (await response.json()) as T;
  }
}
