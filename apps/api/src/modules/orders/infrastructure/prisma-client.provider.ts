import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("ORDERS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the orders repository. */
export const ORDERS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the orders module. */
export const ordersPrismaClientProvider = provider;
