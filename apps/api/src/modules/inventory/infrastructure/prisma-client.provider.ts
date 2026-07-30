import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the inventory repository. */
export const INVENTORY_PRISMA_CLIENT = Symbol("INVENTORY_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the inventory module. */
export const inventoryPrismaClientProvider: Provider = {
  provide: INVENTORY_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
