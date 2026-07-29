/**
 * Minimal structural interfaces over the Prisma client surface this package
 * uses. Depending on these (rather than the concrete `PrismaClient`) keeps the
 * infrastructure helpers unit-testable with lightweight fakes and decoupled
 * from the generated client. The real `PrismaClient` and its interactive
 * transaction client both satisfy these shapes.
 */

/** Something that can run parameterized raw SQL (a client or a transaction). */
export interface SqlExecutor {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** Something that can run an interactive (callback) transaction. */
export interface TransactionRunner {
  $transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** Something that can be probed for liveness. */
export interface HealthProbe {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}
