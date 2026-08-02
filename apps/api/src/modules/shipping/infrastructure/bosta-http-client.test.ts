import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CarrierAuthError, CarrierUnavailableError } from "../domain/shipping.errors";
import { BostaHttpClient } from "./bosta-http-client";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BostaHttpClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the raw API key in the Authorization header and returns the parsed body", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: { list: [] } }));
    const client = new BostaHttpClient("https://api.bosta.test/");
    const result = await client.request<{ success: boolean }>("GET", "pickup-locations", "my-key");
    expect(result).toEqual({ success: true, data: { list: [] } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://api.bosta.test/pickup-locations");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("my-key");
  });

  it("maps a 401/403 to CarrierAuthError", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { success: false }));
    const client = new BostaHttpClient("https://api.bosta.test/");
    await expect(client.request("GET", "pickup-locations", "bad-key")).rejects.toBeInstanceOf(
      CarrierAuthError,
    );
  });

  it("maps a 5xx to CarrierUnavailableError", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { success: false }));
    const client = new BostaHttpClient("https://api.bosta.test/");
    await expect(client.request("GET", "pickup-locations", "key")).rejects.toBeInstanceOf(
      CarrierUnavailableError,
    );
  });

  it("maps a network failure to CarrierUnavailableError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const client = new BostaHttpClient("https://api.bosta.test/");
    await expect(client.request("GET", "pickup-locations", "key")).rejects.toBeInstanceOf(
      CarrierUnavailableError,
    );
  });

  it("sends a JSON body with Content-Type for POST/PUT", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    const client = new BostaHttpClient("https://api.bosta.test/");
    await client.request("POST", "deliveries", "key", { cod: 100 });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.body).toBe(JSON.stringify({ cod: 100 }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});
