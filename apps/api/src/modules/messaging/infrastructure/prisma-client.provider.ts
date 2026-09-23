import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("MESSAGING_PRISMA_CLIENT");

/** DI token for the Prisma client used by the messaging repository. */
export const MESSAGING_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the messaging module. */
export const messagingPrismaClientProvider = provider;
