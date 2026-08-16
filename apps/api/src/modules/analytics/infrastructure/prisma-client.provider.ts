import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("ANALYTICS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the analytics repository. */
export const ANALYTICS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the analytics module. */
export const analyticsPrismaClientProvider = provider;
