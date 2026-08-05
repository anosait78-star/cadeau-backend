/** Raised when a list cursor cannot be decoded/validated (maps to `400`). */
export class InvalidCursorInputError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "InvalidCursorInputError";
  }
}
