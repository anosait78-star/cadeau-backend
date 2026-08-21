import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("REVIEWS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the reviews repository. */
export const REVIEWS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the reviews module. */
export const reviewsPrismaClientProvider = provider;
