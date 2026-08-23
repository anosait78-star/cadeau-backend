import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register-sw";

function stubServiceWorker(register: () => Promise<unknown>): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: { register },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "serviceWorker");
});

describe("registerServiceWorker", () => {
  it("registers the worker at the app scope once the page has loaded", () => {
    const register = vi.fn(() => Promise.resolve({}));
    stubServiceWorker(register);

    registerServiceWorker();
    expect(register).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("does nothing in a browser without service workers", () => {
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("swallows a failed registration — it only costs the install prompt", async () => {
    const register = vi.fn(() => Promise.reject(new Error("blocked")));
    stubServiceWorker(register);

    registerServiceWorker();
    window.dispatchEvent(new Event("load"));

    // A rejected registration must stay swallowed: no throw, no unhandled rejection.
    await Promise.resolve();
    expect(register).toHaveBeenCalled();
  });
});
