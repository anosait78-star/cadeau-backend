import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the process-wide Prisma client used by the auth repository. */
export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

/**
 * Provides the shared Prisma client. Construction is lazy (no connection opened
 * here), so the app boots without a live database; queries connect on first use.
 */
export const prismaClientProvider: Provider = {
  provide: PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
