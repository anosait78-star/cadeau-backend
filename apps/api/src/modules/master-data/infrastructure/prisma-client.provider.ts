import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the master-data repository. */
export const MASTER_DATA_PRISMA_CLIENT = Symbol("MASTER_DATA_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the master-data module. */
export const masterDataPrismaClientProvider: Provider = {
  provide: MASTER_DATA_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
