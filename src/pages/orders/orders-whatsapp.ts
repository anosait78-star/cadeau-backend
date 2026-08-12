import type { Translate } from "@/components/i18n/translate-type";
import { getCustomer } from "@/features/customers/customers-api";
import type { OrderListItem, OrderStatus } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";

/**
 * Order statuses that get a customer-facing WhatsApp nudge (business decision,
 * 2026-08-12): confirming the order, telling them it's ready to ship, and
 * telling them it shipped. No other status gets one.
 */
export const WHATSAPP_STATUSES = ["confirming", "ready", "shipped"] as const;

export type WhatsappStatus = (typeof WHATSAPP_STATUSES)[number];

export function isWhatsappStatus(status: OrderStatus): status is WhatsappStatus {
  return (WHATSAPP_STATUSES as readonly string[]).includes(status);
}

const MESSAGE_KEY: Readonly<Record<WhatsappStatus, TranslationKey>> = {
  confirming: "orders.whatsapp.messageConfirming",
  ready: "orders.whatsapp.messageReady",
  shipped: "orders.whatsapp.messageShipped",
};

/**
 * Customer phones are only ever stored E.164 (`customers` module's
 * `requireE164` write gate) — this is a defensive re-check before building a
 * `wa.me` link, not the source of truth for validity.
 */
function isValidE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone);
}

/**
 * Opens `wa.me/<customer phone>?text=<message>` in a new tab, pre-filled with
 * the status-appropriate message — the user reviews and presses send from
 * their own WhatsApp; nothing is ever sent from the server (no provider
 * integration exists, by design — see the planning discussion, 2026-08-12).
 *
 * The tab is opened synchronously (before the async phone lookup) so browsers
 * don't treat the eventual `wa.me` navigation as a blocked popup; it's
 * redirected once the customer's phone is known. Deliberately opened
 * *without* `noopener` — most modern browsers (Firefox 96+ among them) return
 * `null` from `window.open` when `noopener` is set, which would leave us with
 * no handle to redirect: the user would see an empty blank tab instead of
 * WhatsApp, and the actual `wa.me` navigation (attempted after the `await`,
 * outside the click's call stack) would get silently popup-blocked.
 */
export async function openWhatsappForOrder(
  order: Pick<OrderListItem, "customerId" | "customerName" | "orderNumber">,
  status: WhatsappStatus,
  companyName: string,
  t: Translate,
  onError: (message: string) => void,
): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const customer = await getCustomer(order.customerId);
    if (!isValidE164(customer.phone)) {
      tab?.close();
      onError(t("orders.whatsapp.invalidPhone"));
      return;
    }
    const message = t(MESSAGE_KEY[status], {
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      companyName,
    });
    const digits = customer.phone.replace(/[^0-9]/g, "");
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
    if (tab !== null) {
      tab.location.href = url;
    } else {
      // Popup was blocked outright (e.g. browser setting) — try once more;
      // this one is a same-tick call so it isn't blocked for the "outside the
      // gesture" reason, only if popups are disabled entirely.
      window.open(url, "_blank");
    }
  } catch {
    tab?.close();
    onError(t("orders.whatsapp.invalidPhone"));
  }
}
