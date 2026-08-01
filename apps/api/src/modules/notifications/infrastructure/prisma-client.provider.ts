import { type Provider } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@cadeau/database";

/** DI token for the Prisma client used by the notifications module. */
export const NOTIFICATIONS_PRISMA_CLIENT = Symbol("NOTIFICATIONS_PRISMA_CLIENT");

/** Provides the shared Prisma client singleton to the notifications module. */
export const notificationsPrismaClientProvider: Provider = {
  provide: NOTIFICATIONS_PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrismaClient(),
};
