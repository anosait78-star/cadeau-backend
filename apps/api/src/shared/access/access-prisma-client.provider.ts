import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the access repositories. */
export const ACCESS_PRISMA_CLIENT = Symbol("ACCESS_PRISMA_CLIENT");

/**
 * Provides the shared Prisma client singleton to the access layer. Construction
 * opens no connection; queries connect on first use.
 */
export const accessPrismaClientProvider: Provider = {
  provide: ACCESS_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
