import type { AppConfig } from "@cadeau/config";
import { describe, expect, it, vi } from "vitest";
import { PushSubscriptionGoneError } from "../domain/push-sender.port";
import { WebPushAdapter } from "./web-push.adapter";

const setVapidDetails = vi.fn();
const sendNotification = vi.fn().mockResolvedValue(undefined);

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

function config(): AppConfig {
  return {
    notifications: {
      vapid: { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@cadeau.test" },
    },
  } as unknown as AppConfig;
}

const TARGET = { endpoint: "https://push.example/ep", p256dh: "p", auth: "a" };

describe("WebPushAdapter", () => {
  it("sets VAPID details and sends the JSON-encoded payload", async () => {
    const adapter = new WebPushAdapter(config());
    await adapter.send(TARGET, { title: "Hi", body: "there" });
    expect(setVapidDetails).toHaveBeenCalledWith("mailto:ops@cadeau.test", "pub", "priv");
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: TARGET.endpoint, keys: { p256dh: "p", auth: "a" } },
      JSON.stringify({ title: "Hi", body: "there" }),
    );
  });

  it("maps a 410 Gone response to PushSubscriptionGoneError", async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const adapter = new WebPushAdapter(config());
    await expect(adapter.send(TARGET, {})).rejects.toBeInstanceOf(PushSubscriptionGoneError);
  });

  it("maps a 404 response to PushSubscriptionGoneError", async () => {
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
    const adapter = new WebPushAdapter(config());
    await expect(adapter.send(TARGET, {})).rejects.toBeInstanceOf(PushSubscriptionGoneError);
  });

  it("rethrows any other failure unchanged", async () => {
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { statusCode: 429 }),
    );
    const adapter = new WebPushAdapter(config());
    await expect(adapter.send(TARGET, {})).rejects.toThrow("rate limited");
  });

  it("rethrows a plain error with no statusCode unchanged", async () => {
    sendNotification.mockRejectedValueOnce(new Error("network down"));
    const adapter = new WebPushAdapter(config());
    await expect(adapter.send(TARGET, {})).rejects.toThrow("network down");
  });
});
