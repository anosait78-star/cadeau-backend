import type { Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/**
 * Build a `{ token, provider }` pair for a module's Prisma-client DI token —
 * the shared body every module's `*_PRISMA_CLIENT` provider used to duplicate.
 * `tokenName` only feeds the Symbol's description (for debugging); the token
 * itself is still a fresh, module-private Symbol.
 */
export function createPrismaClientProvider(tokenName: string): {
  readonly token: symbol;
  readonly provider: Provider;
} {
  const token = Symbol(tokenName);
  return {
    token,
    provider: { provide: token, useFactory: (): PrismaClient => getPrismaClient() },
  };
}
