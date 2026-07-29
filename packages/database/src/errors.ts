/** Base class for every error raised by the database infrastructure layer. */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Thrown when a value that must be a tenant (company) UUID is not one. Guards
 * the RLS context so a malformed identifier can never reach the database.
 */
export class InvalidCompanyIdError extends DatabaseError {
  constructor(received: unknown) {
    super(
      `Invalid company id: expected a UUID, received ${InvalidCompanyIdError.describe(received)}.`,
    );
  }

  private static describe(received: unknown): string {
    if (typeof received === "string") return `"${received}"`;
    return typeof received;
  }
}

/** Thrown when the development seed is invoked against a production database. */
export class DevSeedInProductionError extends DatabaseError {
  constructor() {
    super("The development seed must never run in production (NODE_ENV=production).");
  }
}

/**
 * Thrown when a pagination cursor is malformed. Cursors are opaque, server-issued
 * tokens; a client that hand-crafts or corrupts one gets a clean rejection rather
 * than an unpredictable query (see api-conventions §5).
 */
export class InvalidCursorError extends DatabaseError {
  constructor() {
    super("Invalid pagination cursor.");
  }
}
