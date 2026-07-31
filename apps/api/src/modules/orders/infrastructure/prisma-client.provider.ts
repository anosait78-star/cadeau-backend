import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the orders repository. */
export const ORDERS_PRISMA_CLIENT = Symbol("ORDERS_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the orders module. */
export const ordersPrismaClientProvider: Provider = {
  provide: ORDERS_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
