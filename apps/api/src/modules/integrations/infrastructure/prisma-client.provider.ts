import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("INTEGRATIONS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the integrations (storefront) repositories. */
export const INTEGRATIONS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the integrations module. */
export const integrationsPrismaClientProvider = provider;
