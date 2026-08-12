import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWhatsappStatus, openWhatsappForOrder, WHATSAPP_STATUSES } from "./orders-whatsapp";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ORDER = { customerId: "c1", customerName: "سارة", orderNumber: 42 };

const TEMPLATES: Record<string, string> = {
  "orders.whatsapp.messageConfirming": "Hi {{customerName}} #{{orderNumber}} {{companyName}}",
  "orders.whatsapp.messageReady": "Ready {{customerName}} #{{orderNumber}} {{companyName}}",
  "orders.whatsapp.messageShipped": "Shipped {{customerName}} #{{orderNumber}} {{companyName}}",
  "orders.whatsapp.invalidPhone": "Invalid phone",
};

function t(key: string, vars?: Record<string, string | number>): string {
  let out = TEMPLATES[key] ?? key;
  if (vars !== undefined) {
    for (const [k, v] of Object.entries(vars)) out = out.replace(`{{${k}}}`, String(v));
  }
  return out;
}

describe("isWhatsappStatus", () => {
  it("is true only for confirming/ready/shipped", () => {
    for (const s of WHATSAPP_STATUSES) expect(isWhatsappStatus(s)).toBe(true);
    expect(isWhatsappStatus("new")).toBe(false);
    expect(isWhatsappStatus("delivered")).toBe(false);
    expect(isWhatsappStatus("cancelled")).toBe(false);
  });
});

describe("openWhatsappForOrder", () => {
  let fakeTab: { location: { href: string }; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeTab = { location: { href: "" }, close: vi.fn() };
    vi.stubGlobal(
      "open",
      vi.fn(() => fakeTab as unknown as Window),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a wa.me link with the phone digits and the interpolated message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(200, { phone: "+201234567890" }))),
    );
    const onError = vi.fn();

    await openWhatsappForOrder(ORDER, "confirming", "Cadeau", t, onError);

    expect(onError).not.toHaveBeenCalled();
    expect(fakeTab.location.href).toContain("https://wa.me/201234567890?text=");
    expect(decodeURIComponent(fakeTab.location.href)).toContain("Hi سارة #42 Cadeau");
  });

  it("picks the message matching the given status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(200, { phone: "+201234567890" }))),
    );
    await openWhatsappForOrder(ORDER, "shipped", "Cadeau", t, vi.fn());
    expect(decodeURIComponent(fakeTab.location.href)).toContain("Shipped سارة #42 Cadeau");
  });

  it("reports an error and closes the tab when the phone isn't valid E.164", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(200, { phone: "not-a-phone" }))),
    );
    const onError = vi.fn();

    await openWhatsappForOrder(ORDER, "ready", "Cadeau", t, onError);

    expect(onError).toHaveBeenCalledWith("Invalid phone");
    expect(fakeTab.close).toHaveBeenCalled();
    expect(fakeTab.location.href).toBe("");
  });

  it("reports an error when the customer lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }))),
    );
    const onError = vi.fn();

    await openWhatsappForOrder(ORDER, "shipped", "Cadeau", t, onError);

    expect(onError).toHaveBeenCalledWith("Invalid phone");
    expect(fakeTab.close).toHaveBeenCalled();
  });
});
