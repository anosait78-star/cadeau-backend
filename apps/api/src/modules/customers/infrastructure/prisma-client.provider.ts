import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the customers repository. */
export const CUSTOMERS_PRISMA_CLIENT = Symbol("CUSTOMERS_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the customers module. */
export const customersPrismaClientProvider: Provider = {
  provide: CUSTOMERS_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
