import { describe, expect, it } from "vitest";
import { dictionaries, type TranslationKey } from "@/i18n/dictionaries";
import { notificationText } from "./notification-content";
import type { NotificationItem, NotificationType } from "./notifications-api";

/** A `t` bound to one locale, matching what `useI18n` hands components. */
function translator(locale: "ar" | "en") {
  return (key: TranslationKey, vars?: Record<string, string | number>): string =>
    dictionaries[locale][key].replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      vars !== undefined && name in vars ? String(vars[name]) : match,
    );
}

function item(
  type: NotificationType,
  payload: unknown,
  over: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id: "n1",
    type,
    title: "stored title",
    body: "stored body",
    payload,
    readAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("notificationText", () => {
  it("names the customer and the order on a new order, in Arabic", () => {
    const text = notificationText(
      item("order.created", {
        orderId: "o1",
        orderNumber: 42,
        customerName: "ليلى حسن",
        totalMinor: 25_000,
      }),
      translator("ar"),
      "ar",
    );
    expect(text.title).toBe("طلب جديد");
    expect(text.body).toContain("ليلى حسن");
    expect(text.body).toContain("42");
    expect(text.body).toContain("250.00");
  });

  it("renders the same row in English", () => {
    const text = notificationText(
      item("order.created", {
        orderId: "o1",
        orderNumber: 42,
        customerName: "Layla Hassan",
        totalMinor: 25_000,
      }),
      translator("en"),
      "en",
    );
    expect(text.title).toBe("New order");
    expect(text.body).toBe("Order #42 from Layla Hassan for 250.00.");
  });

  it("omits the total when the payload has none", () => {
    const text = notificationText(
      item("order.created", { orderId: "o1", orderNumber: 7, customerName: "Layla" }),
      translator("en"),
      "en",
    );
    expect(text.body).toBe("Order #7 from Layla.");
  });

  it("uses the localized status label on a status change", () => {
    const text = notificationText(
      item("order.status_changed", {
        orderId: "o1",
        orderNumber: 9,
        customerName: "ليلى",
        toStatus: "shipped",
      }),
      translator("ar"),
      "ar",
    );
    expect(text.body).toContain("تم الشحن");
    expect(text.body).not.toContain("shipped");
  });

  it("falls back to the raw status when the value is unknown to this build", () => {
    const text = notificationText(
      item("order.status_changed", {
        orderId: "o1",
        orderNumber: 9,
        customerName: "Layla",
        toStatus: "teleported",
      }),
      translator("en"),
      "en",
    );
    expect(text.body).toContain("teleported");
  });

  it("renders a collected payment with the amount", () => {
    const text = notificationText(
      item("payment.collected", {
        orderId: "o1",
        orderNumber: 9,
        customerName: "Layla",
        amountMinor: 1500,
      }),
      translator("en"),
      "en",
    );
    expect(text.body).toBe("Collected 15.00 on Layla's order #9.");
  });

  it("never renders a customer on a vendor's notification", () => {
    const text = notificationText(
      item("order_vendor_group.assigned", {
        orderId: "o1",
        orderNumber: 9,
        orderVendorGroupId: "g1",
        warehouseId: "w1",
      }),
      translator("en"),
      "en",
    );
    expect(text.body).toBe("You have a new order to prepare: #9.");
  });

  it("falls back to the stored strings for a row written before the structured payload", () => {
    const text = notificationText(
      item("order.status_changed", { orderId: "o1", fromStatus: "new", toStatus: "shipped" }),
      translator("ar"),
      "ar",
    );
    expect(text).toEqual({ title: "stored title", body: "stored body" });
  });

  it("renders a message notification's preview, in Arabic and English", () => {
    const ar = notificationText(
      item("message.received", { threadId: "t1", preview: "هل الطلب جاهز؟" }),
      translator("ar"),
      "ar",
    );
    expect(ar.title).toBe("رسالة جديدة");
    expect(ar.body).toBe("هل الطلب جاهز؟");

    const en = notificationText(
      item("message.received", { threadId: "t1", preview: "Is it ready?" }),
      translator("en"),
      "en",
    );
    expect(en.title).toBe("New message");
    expect(en.body).toBe("Is it ready?");
  });

  it("falls back to a generic body for an image-only message (no preview)", () => {
    const text = notificationText(
      item("message.received", { threadId: "t1", preview: "" }),
      translator("en"),
      "en",
    );
    expect(text.body).toBe("You have a new message.");
  });

  it("falls back rather than throwing on a null or malformed payload", () => {
    for (const payload of [null, undefined, "nonsense", 7]) {
      expect(notificationText(item("order.created", payload), translator("en"), "en")).toEqual({
        title: "stored title",
        body: "stored body",
      });
    }
  });
});
