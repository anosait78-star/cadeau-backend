import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("PRISMA_CLIENT");

/** DI token for the process-wide Prisma client used by the auth repository. */
export const PRISMA_CLIENT = token;

/**
 * Provides the shared Prisma client. Construction is lazy (no connection opened
 * here), so the app boots without a live database; queries connect on first use.
 */
export const prismaClientProvider = provider;
