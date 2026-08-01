import { describe, expect, it } from "vitest";
import { LoggingCustomerMessagingAdapter } from "./logging-customer-messaging.adapter";

describe("LoggingCustomerMessagingAdapter", () => {
  it("sends nothing and reports sent: false (decision D5)", async () => {
    const adapter = new LoggingCustomerMessagingAdapter();
    const result = await adapter.send({
      companyId: "c1",
      orderId: "o1",
      template: "order_status_changed",
      params: { toStatus: "shipped" },
    });
    expect(result).toEqual({ sent: false });
  });
});
