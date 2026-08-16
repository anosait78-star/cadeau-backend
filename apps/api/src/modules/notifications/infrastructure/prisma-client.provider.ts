import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("NOTIFICATIONS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the notifications module. */
export const NOTIFICATIONS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the notifications module. */
export const notificationsPrismaClientProvider = provider;
