import { Injectable, Logger } from "@nestjs/common";
import type {
  CustomerMessageInput,
  CustomerMessagingPort,
} from "../domain/customer-messaging.port";

/**
 * The only bound {@link CustomerMessagingPort} implementation today (EPIC-15,
 * decision D5): sends nothing. No vetted WhatsApp/SMS provider credentials
 * exist in this environment — mirrors EPIC-12/D1's `ManualCarrierAdapter`
 * (real carrier deferred). A real adapter is a drop-in swap; `params` is
 * logged, never persisted, and must already be PII-free by the time it
 * reaches this port.
 */
@Injectable()
export class LoggingCustomerMessagingAdapter implements CustomerMessagingPort {
  private readonly logger = new Logger(LoggingCustomerMessagingAdapter.name);

  send(input: CustomerMessageInput): Promise<{ sent: boolean }> {
    this.logger.log(
      `[customer-messaging:stub] would send "${input.template}" for order ${input.orderId} ` +
        `(company ${input.companyId}) — no provider configured (EPIC-15/D5).`,
    );
    return Promise.resolve({ sent: false });
  }
}
