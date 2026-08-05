import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the finance repository. */
export const FINANCE_PRISMA_CLIENT = Symbol("FINANCE_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the finance module. */
export const financePrismaClientProvider: Provider = {
  provide: FINANCE_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
