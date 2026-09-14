import { dictionaries, type TranslationKey } from "@/i18n/dictionaries";
import { formatMoney } from "@/lib/format-money";
import type { NotificationItem } from "./notifications-api";

/** The two lines one notification shows, already in the reader's language. */
export interface NotificationText {
  readonly title: string;
  readonly body: string;
}

/** The `t` shape this module needs — kept structural so it is trivial to test. */
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * The structured facts the API stores on a notification's `payload`. Every
 * field is optional here on purpose: rows written before this shape existed
 * carry only `orderId`, and the renderer must degrade rather than throw.
 */
interface NotificationPayload {
  readonly orderNumber: number | undefined;
  readonly customerName: string | undefined;
  readonly totalMinor: number | undefined;
  readonly amountMinor: number | undefined;
  readonly toStatus: string | undefined;
}

const NO_PAYLOAD: NotificationPayload = {
  orderNumber: undefined,
  customerName: undefined,
  totalMinor: undefined,
  amountMinor: undefined,
  toStatus: undefined,
};

function readPayload(raw: unknown): NotificationPayload {
  if (typeof raw !== "object" || raw === null) return NO_PAYLOAD;
  const record = raw as Record<string, unknown>;
  const pick = <T>(key: string, kind: "string" | "number"): T | undefined =>
    typeof record[key] === kind ? (record[key] as T) : undefined;
  return {
    orderNumber: pick<number>("orderNumber", "number"),
    customerName: pick<string>("customerName", "string"),
    totalMinor: pick<number>("totalMinor", "number"),
    amountMinor: pick<number>("amountMinor", "number"),
    toStatus: pick<string>("toStatus", "string"),
  };
}

/** The localized label for an order status, or the raw value if it is unknown to this build. */
function statusLabel(t: Translate, status: string): string {
  const key = `orders.status.${status}` as TranslationKey;
  return key in dictionaries.en ? t(key) : status;
}

/**
 * Renders one notification into the reader's language.
 *
 * The server writes a row **once**, but the reader's language is a client
 * concern — so the row carries a stable `type` plus a structured `payload`
 * (customer name, order number, amounts) and the sentence is composed here
 * from the i18n dictionaries. The stored `title`/`body` stay as the fallback:
 * they are what Web Push shows (rendered by the OS, not by this app) and what
 * rows created before the structured payload existed carry. So a notification
 * whose payload is missing the facts a template needs falls back to the stored
 * strings rather than rendering a sentence full of blanks.
 */
export function notificationText(
  item: NotificationItem,
  t: Translate,
  locale: string,
): NotificationText {
  const stored: NotificationText = { title: item.title, body: item.body };
  const payload = readPayload(item.payload);
  const { customerName, orderNumber } = payload;

  switch (item.type) {
    case "order.created": {
      if (customerName === undefined || orderNumber === undefined) return stored;
      const body =
        payload.totalMinor === undefined
          ? t("notifications.content.orderCreated.body", { customerName, orderNumber })
          : t("notifications.content.orderCreated.bodyWithTotal", {
              customerName,
              orderNumber,
              total: formatMoney(payload.totalMinor, locale),
            });
      return { title: t("notifications.content.orderCreated.title"), body };
    }
    case "order.status_changed": {
      if (customerName === undefined || orderNumber === undefined) return stored;
      if (payload.toStatus === undefined) return stored;
      return {
        title: t("notifications.content.orderStatusChanged.title"),
        body: t("notifications.content.orderStatusChanged.body", {
          customerName,
          orderNumber,
          status: statusLabel(t, payload.toStatus),
        }),
      };
    }
    case "payment.collected": {
      if (customerName === undefined || orderNumber === undefined) return stored;
      if (payload.amountMinor === undefined) return stored;
      return {
        title: t("notifications.content.paymentCollected.title"),
        body: t("notifications.content.paymentCollected.body", {
          customerName,
          orderNumber,
          amount: formatMoney(payload.amountMinor, locale),
        }),
      };
    }
    case "order_vendor_group.assigned": {
      // A vendor's notification deliberately carries no customer, only the
      // order number — so it never renders the buyer (Vendor Accounts, Phase 5).
      if (orderNumber === undefined) return stored;
      return {
        title: t("notifications.content.vendorGroupAssigned.title"),
        body: t("notifications.content.vendorGroupAssigned.body", { orderNumber }),
      };
    }
    default:
      return stored;
  }
}
