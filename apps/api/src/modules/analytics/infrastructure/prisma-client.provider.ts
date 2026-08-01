import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the analytics repository. */
export const ANALYTICS_PRISMA_CLIENT = Symbol("ANALYTICS_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the analytics module. */
export const analyticsPrismaClientProvider: Provider = {
  provide: ANALYTICS_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
