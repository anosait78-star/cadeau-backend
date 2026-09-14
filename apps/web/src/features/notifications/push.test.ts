import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disablePush, enablePush, getPushState, isPushSupported } from "./push";

/**
 * A subscription as `pushManager` hands it back. `keys: null` models the
 * degenerate case where the browser produced no encryption keys — passing
 * `undefined` would silently take the default instead.
 */
function subscription(keys: Record<string, string> | null = { p256dh: "key", auth: "auth" }) {
  return {
    endpoint: "https://push.example/ep",
    toJSON: () => ({ endpoint: "https://push.example/ep", ...(keys === null ? {} : { keys }) }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

/** Installs a browser that supports push, with the given permission state. */
function stubBrowser(
  permission: NotificationPermission,
  existing: ReturnType<typeof subscription> | null = null,
) {
  const subscribe = vi.fn().mockResolvedValue(subscription());
  const getSubscription = vi.fn().mockResolvedValue(existing);
  const requestPermission = vi.fn().mockResolvedValue(permission);

  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { subscribe, getSubscription } }) },
  });
  return { subscribe, getSubscription, requestPermission };
}

const fetchJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("push", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/push/key")
          ? // A real base64url VAPID key is 87 chars; any valid base64url works here.
            fetchJson({ publicKey: "BFooBar_-9w" })
          : fetchJson({ id: "sub1", endpoint: "https://push.example/ep" }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a browser without the Push API as unsupported", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    // No PushManager on window.
    expect(isPushSupported()).toBe(false);
    expect(await getPushState()).toBe("unsupported");
  });

  it("reports a refused permission as denied, and never prompts again", async () => {
    const { requestPermission } = stubBrowser("denied");

    expect(await getPushState()).toBe("denied");
    expect(await enablePush()).toBe("denied");
    // requestPermission resolving "denied" is the only call; nothing is registered.
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("subscribes and registers the endpoint once permission is granted", async () => {
    const { subscribe } = stubBrowser("granted");

    expect(await enablePush()).toBe("enabled");

    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    const posted = fetchMock.mock.calls.find((c) => String(c[0]).includes("/push/subscriptions"));
    expect(posted).toBeDefined();
    expect(JSON.parse((posted![1] as RequestInit).body as string)).toMatchObject({
      endpoint: "https://push.example/ep",
      keys: { p256dh: "key", auth: "auth" },
    });
  });

  it("reuses an existing subscription rather than creating a second one", async () => {
    const { subscribe } = stubBrowser("granted", subscription());

    expect(await enablePush()).toBe("enabled");

    expect(subscribe).not.toHaveBeenCalled();
    // Still re-registered, which is what repairs a server-side row that was pruned.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/push/subscriptions"))).toBe(
      true,
    );
  });

  it("drops a subscription that carries no keys instead of registering it", async () => {
    const keyless = subscription(null);
    stubBrowser("granted", keyless);

    expect(await enablePush()).toBe("idle");

    expect(keyless.unsubscribe).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/push/subscriptions"))).toBe(
      false,
    );
  });

  it("reports an existing subscription as enabled", async () => {
    stubBrowser("granted", subscription());
    expect(await getPushState()).toBe("enabled");
  });

  it("unsubscribes the device and forgets it server-side", async () => {
    const existing = subscription();
    stubBrowser("granted", existing);

    expect(await disablePush("sub1")).toBe("idle");

    expect(existing.unsubscribe).toHaveBeenCalled();
    const deleted = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/push/subscriptions/sub1"),
    );
    expect((deleted![1] as RequestInit).method).toBe("DELETE");
  });
});
