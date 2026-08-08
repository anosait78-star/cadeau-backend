import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the integrations (storefront) repositories. */
export const INTEGRATIONS_PRISMA_CLIENT = Symbol("INTEGRATIONS_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the integrations module. */
export const integrationsPrismaClientProvider: Provider = {
  provide: INTEGRATIONS_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
