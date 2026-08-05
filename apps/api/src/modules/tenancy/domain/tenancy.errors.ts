/**
 * Tenancy domain errors — framework-free signals the application layer maps to
 * HTTP responses, preserving the layer boundary (infrastructure raises them, the
 * service translates them).
 */

/** Base for tenancy domain errors. */
export class TenancyDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The requested company slug is already taken (unique constraint). */
export class SlugAlreadyTakenError extends TenancyDomainError {
  constructor() {
    super("Company slug is already taken.");
  }
}
