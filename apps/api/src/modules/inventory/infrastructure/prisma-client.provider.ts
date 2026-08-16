import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("INVENTORY_PRISMA_CLIENT");

/** DI token for the Prisma client used by the inventory repository. */
export const INVENTORY_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the inventory module. */
export const inventoryPrismaClientProvider = provider;
