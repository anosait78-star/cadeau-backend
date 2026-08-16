import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("SHIPPING_PRISMA_CLIENT");

/** DI token for the Prisma client used by the shipping repository. */
export const SHIPPING_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the shipping module. */
export const shippingPrismaClientProvider = provider;
