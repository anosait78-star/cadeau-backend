import { getConfig } from "@cadeau/config";
import { PrismaClient } from "@prisma/client";

/** Log levels Prisma understands. */
export type PrismaLogLevel = "query" | "info" | "warn" | "error";

/** Application log levels (mirrors `@cadeau/config` `LoggingConfig.level`). */
export type AppLogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface CreatePrismaClientOptions {
  /** Connection string. Defaults to `@cadeau/config` `database.url`. */
  readonly url?: string;
  /** App log level. Defaults to `@cadeau/config` `logging.level`. */
  readonly logLevel?: AppLogLevel;
}

/**
 * Translate an application log level into the set of Prisma log events to emit.
 * More verbose app levels enable more Prisma events; `query` logging is only
 * enabled at `debug`/`trace` to avoid leaking SQL in normal operation.
 */
export function toPrismaLogLevels(level: AppLogLevel): PrismaLogLevel[] {
  switch (level) {
    case "trace":
    case "debug":
      return ["query", "info", "warn", "error"];
    case "info":
      return ["info", "warn", "error"];
    case "warn":
      return ["warn", "error"];
    case "error":
    case "fatal":
      return ["error"];
  }
}

/**
 * Construct a new `PrismaClient`. Connection string and log level come from
 * `@cadeau/config` unless overridden (the override exists for tests and tools;
 * application code should rely on the config defaults). Construction is lazy —
 * no connection is opened until the first query.
 */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const url = options.url ?? getConfig().database.url;
  const logLevel = options.logLevel ?? getConfig().logging.level;
  return new PrismaClient({
    datasourceUrl: url,
    log: toPrismaLogLevels(logLevel),
  });
}

let singleton: PrismaClient | undefined;

/**
 * Return the process-wide `PrismaClient` singleton, creating it on first use.
 * `options` are honoured only when the singleton is first created.
 */
export function getPrismaClient(options?: CreatePrismaClientOptions): PrismaClient {
  singleton ??= createPrismaClient(options);
  return singleton;
}

/** Disconnect and clear the singleton. Safe to call when none exists. */
export async function disconnectPrisma(): Promise<void> {
  if (singleton !== undefined) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}
