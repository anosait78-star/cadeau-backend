import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the products repository. */
export const PRODUCTS_PRISMA_CLIENT = Symbol("PRODUCTS_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the products module. */
export const productsPrismaClientProvider: Provider = {
  provide: PRODUCTS_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
