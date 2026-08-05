import { Injectable } from "@nestjs/common";
import { AppLogger } from "../../../shared/logging/app-logger";
import type { AuthAuditDetails, AuthAuditEvent, AuthAuditPort } from "../domain/auth-audit.port";

/**
 * Records auth events through the structured logger (see {@link AuthAuditPort}).
 * Auth precedes any tenant context, so these cannot be written to the
 * tenant-scoped `audit_log`; they are emitted as structured log lines carrying
 * the correlation id (added by the logger) and only non-sensitive identifiers —
 * never credentials, tokens, or 2FA secrets.
 */
@Injectable()
export class LoggerAuthAuditAdapter implements AuthAuditPort {
  constructor(private readonly logger: AppLogger) {}

  record(event: AuthAuditEvent, details: AuthAuditDetails): void {
    this.logger.log(JSON.stringify({ event, ...details }), "AuthAudit");
  }
}
