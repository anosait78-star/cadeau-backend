import { Global, Module } from "@nestjs/common";
import { SESSION_REISSUE } from "../../shared/contracts/session-reissue.port";
import { systemClockProvider } from "../../shared/time/clock";
import { AuthService } from "./application/auth.service";
import { TokenService } from "./application/token.service";
import { AUTH_AUDIT } from "./domain/auth-audit.port";
import { AUTH_REPOSITORY } from "./domain/auth-repository.port";
import { AuthRepository } from "./infrastructure/auth.repository";
import { LoggerAuthAuditAdapter } from "./infrastructure/logger-auth-audit.adapter";
import { prismaClientProvider } from "./infrastructure/prisma-client.provider";
import { AuthController } from "./presentation/auth.controller";

/**
 * Auth feature module (composition root). Wires the controller → application
 * services → ports, and binds each port to its infrastructure adapter. The clock
 * is provided here so token issuance/verification is deterministic under test.
 *
 * Marked `@Global` so the {@link SESSION_REISSUE} contract it implements is
 * available to sibling features (tenancy's create/switch) without a direct
 * module import — features couple only through `shared/contracts`.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    systemClockProvider,
    prismaClientProvider,
    { provide: AUTH_REPOSITORY, useClass: AuthRepository },
    { provide: AUTH_AUDIT, useClass: LoggerAuthAuditAdapter },
    { provide: SESSION_REISSUE, useExisting: AuthService },
  ],
  exports: [SESSION_REISSUE],
})
export class AuthModule {}
