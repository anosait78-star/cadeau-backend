import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("TENANCY_PRISMA_CLIENT");

/** DI token for the process-wide Prisma client used by the tenancy repository. */
export const TENANCY_PRISMA_CLIENT = token;

/**
 * Provides the shared Prisma client (the same lazily-constructed singleton the
 * rest of the app uses). Construction opens no connection; queries connect on
 * first use.
 */
export const tenancyPrismaClientProvider = provider;
