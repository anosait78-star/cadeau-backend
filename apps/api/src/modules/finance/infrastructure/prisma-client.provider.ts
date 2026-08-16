import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("FINANCE_PRISMA_CLIENT");

/** DI token for the Prisma client used by the finance repository. */
export const FINANCE_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the finance module. */
export const financePrismaClientProvider = provider;
