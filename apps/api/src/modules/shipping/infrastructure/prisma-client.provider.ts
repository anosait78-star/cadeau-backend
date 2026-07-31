import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the shipping repository. */
export const SHIPPING_PRISMA_CLIENT = Symbol("SHIPPING_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the shipping module. */
export const shippingPrismaClientProvider: Provider = {
  provide: SHIPPING_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
