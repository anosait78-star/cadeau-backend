import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the process-wide Prisma client used by the tenancy repository. */
export const TENANCY_PRISMA_CLIENT = Symbol("TENANCY_PRISMA_CLIENT");

/**
 * Provides the shared Prisma client (the same lazily-constructed singleton the
 * rest of the app uses). Construction opens no connection; queries connect on
 * first use.
 */
export const tenancyPrismaClientProvider: Provider = {
  provide: TENANCY_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
