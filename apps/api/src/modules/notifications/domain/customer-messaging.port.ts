/** A message template the end-customer channel can send (closed set, D5). */
export type CustomerMessageTemplate = "order_status_changed";

export interface CustomerMessageInput {
  readonly companyId: string;
  readonly orderId: string;
  readonly template: CustomerMessageTemplate;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Port for end-customer WhatsApp/SMS messaging (EPIC-15, decision D5) —
 * mirrors {@link ../../shipping/domain/carrier.port.ts | CarrierPort} exactly:
 * a real provider is a drop-in adapter swap, never a caller change. The only
 * bound implementation today is `LoggingCustomerMessagingAdapter`, which
 * sends nothing (`sent: false`) — no vetted provider credentials exist in
 * this environment (mirrors EPIC-12/D1's `ManualCarrierAdapter`).
 */
export interface CustomerMessagingPort {
  send(input: CustomerMessageInput): Promise<{ readonly sent: boolean }>;
}

/** DI token for {@link CustomerMessagingPort}. */
export const CUSTOMER_MESSAGING = Symbol("CUSTOMER_MESSAGING");
