import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("CUSTOMERS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the customers repository. */
export const CUSTOMERS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the customers module. */
export const customersPrismaClientProvider = provider;
