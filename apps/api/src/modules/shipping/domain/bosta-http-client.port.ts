/**
 * Port for the outbound Bosta REST call. The application layer depends on
 * this, never on the concrete `fetch` wrapper (`layer-application-no-outer`).
 */
export interface BostaHttpClientPort {
  request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    apiKey?: string,
    body?: unknown,
  ): Promise<T>;
}

/** DI token for {@link BostaHttpClientPort}. */
export const BOSTA_HTTP_CLIENT = Symbol("BOSTA_HTTP_CLIENT");
