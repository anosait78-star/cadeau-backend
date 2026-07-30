import { Injectable } from "@nestjs/common";
import { AppLogger } from "../../../shared/logging/app-logger";
import type {
  TenancyAuditDetails,
  TenancyAuditEvent,
  TenancyAuditPort,
} from "../domain/tenancy-audit.port";

/**
 * Records tenancy events through the structured logger (see
 * {@link TenancyAuditPort}). Emits only non-sensitive identifiers — never invite
 * codes or tokens — carrying the request correlation id added by the logger.
 */
@Injectable()
export class LoggerTenancyAuditAdapter implements TenancyAuditPort {
  constructor(private readonly logger: AppLogger) {}

  record(event: TenancyAuditEvent, details: TenancyAuditDetails): void {
    this.logger.log(JSON.stringify({ event, ...details }), "TenancyAudit");
  }
}
