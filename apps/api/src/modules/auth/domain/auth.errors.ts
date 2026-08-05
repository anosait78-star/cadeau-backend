/**
 * Auth domain errors — framework-free signals the application layer maps to HTTP
 * responses. Keeping them here (not `HttpException`s) preserves the layer
 * boundary: infrastructure raises them, the service translates them.
 */

/** Base for auth domain errors. */
export class AuthDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The email is already registered. Raised by the repository on the unique
 * constraint; the service maps it to a `409 CONFLICT`. The message is generic so
 * it can be surfaced without leaking which accounts exist beyond the conflict
 * itself (registration inherently reveals email availability).
 */
export class EmailAlreadyExistsError extends AuthDomainError {
  constructor() {
    super("Email is already registered.");
  }
}
