import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("MASTER_DATA_PRISMA_CLIENT");

/** DI token for the Prisma client used by the master-data repository. */
export const MASTER_DATA_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the master-data module. */
export const masterDataPrismaClientProvider = provider;
