import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("PRODUCTS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the products repository. */
export const PRODUCTS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the products module. */
export const productsPrismaClientProvider = provider;
