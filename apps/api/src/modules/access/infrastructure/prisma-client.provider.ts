import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("ACCESS_MODULE_PRISMA_CLIENT");

/** DI token for the Prisma client used by the access module's repositories. */
export const ACCESS_MODULE_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the access module. */
export const accessModulePrismaClientProvider = provider;
