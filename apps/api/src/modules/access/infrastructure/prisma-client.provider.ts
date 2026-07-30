import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the access module's repositories. */
export const ACCESS_MODULE_PRISMA_CLIENT = Symbol("ACCESS_MODULE_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the access module. */
export const accessModulePrismaClientProvider: Provider = {
  provide: ACCESS_MODULE_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
