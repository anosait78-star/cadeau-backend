import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTokens, writeTokens } from "@/auth/auth-storage";
import { ApiError, apiFetch, apiFetchBlob } from "./api-client";

/** Build a JSON Response with the given status. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** An error-envelope Response (§3). */
function errorEnvelope(status: number, code: string, details?: unknown): Response {
  return json(status, {
    error: { code, message: "x", statusCode: status, requestId: "req_1", details: details ?? null },
  });
}

describe("apiFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the decoded JSON body on success", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "u1" }));
    const result = await apiFetch<{ id: string }>("/me");
    expect(result).toEqual({ id: "u1" });
  });

  it("returns undefined for a 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await apiFetch<void>("/auth/logout", { method: "POST" });
    expect(result).toBeUndefined();
  });

  it("throws a typed ApiError decoded from the envelope", async () => {
    fetchMock.mockResolvedValueOnce(errorEnvelope(409, "CONFLICT"));
    await expect(
      apiFetch("/auth/register", { method: "POST", body: {}, auth: false }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
    });
  });

  it("attaches the bearer token on authenticated requests", async () => {
    writeTokens({ accessToken: "tok", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await apiFetch("/me");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("surfaces a 2FA challenge without attempting a refresh", async () => {
    writeTokens({ accessToken: "tok", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(
      errorEnvelope(401, "UNAUTHORIZED", { twoFactorRequired: true }),
    );
    const err = await apiFetch("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).twoFactorRequired).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh round-trip
  });

  it("refreshes once on a 401 and retries the original request", async () => {
    writeTokens({ accessToken: "stale", refreshToken: "r0", expiresIn: 300 });
    fetchMock
      .mockResolvedValueOnce(errorEnvelope(401, "UNAUTHORIZED")) // original: expired
      .mockResolvedValueOnce(
        json(200, { accessToken: "fresh", refreshToken: "r1", expiresIn: 300 }),
      ) // refresh
      .mockResolvedValueOnce(json(200, { ok: true })); // retry

    const result = await apiFetch<{ ok: boolean }>("/me");
    expect(result).toEqual({ ok: true });
    expect(readTokens()?.accessToken).toBe("fresh");
    // The retry carried the fresh token.
    const retryInit = fetchMock.mock.calls[2]![1] as RequestInit;
    expect((retryInit.headers as Record<string, string>)["Authorization"]).toBe("Bearer fresh");
  });

  it("clears tokens and throws when the refresh itself fails", async () => {
    writeTokens({ accessToken: "stale", refreshToken: "r0", expiresIn: 300 });
    fetchMock
      .mockResolvedValueOnce(errorEnvelope(401, "UNAUTHORIZED"))
      .mockResolvedValueOnce(errorEnvelope(401, "UNAUTHORIZED")); // refresh rejected

    await expect(apiFetch("/me")).rejects.toBeInstanceOf(ApiError);
    expect(readTokens()).toBeNull();
  });
});

describe("apiFetchBlob", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to a GET with no body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob(["x"]), { status: 200 }));
    await apiFetchBlob("/finance/invoices/inv1/pdf");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("sends a POST with a JSON body when given one (analytics export)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob(["a,b\r\n"]), { status: 200 }));
    await apiFetchBlob("/analytics/export", { method: "POST", body: { axis: "business" } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ axis: "business" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("throws an ApiError on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      json(422, { error: { code: "VALIDATION_FAILED", message: "bad", statusCode: 422 } }),
    );
    await expect(
      apiFetchBlob("/analytics/export", { method: "POST", body: {} }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
