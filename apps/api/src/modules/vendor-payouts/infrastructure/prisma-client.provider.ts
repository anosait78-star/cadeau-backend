import { createPrismaClientProvider } from "../../../shared/database/prisma-client-provider";

const { token, provider } = createPrismaClientProvider("VENDOR_PAYOUTS_PRISMA_CLIENT");

/** DI token for the Prisma client used by the vendor-payouts repository. */
export const VENDOR_PAYOUTS_PRISMA_CLIENT = token;

/** Provides the shared Prisma client singleton to the vendor-payouts module. */
export const vendorPayoutsPrismaClientProvider = provider;
