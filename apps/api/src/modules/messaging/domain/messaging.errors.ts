/**
 * Messaging domain errors (EPIC-17). Thrown by the domain/repository and
 * mapped to the api-conventions error envelope by the application service —
 * so the domain never depends on HTTP.
 */

/**
 * Two callers opened the same vendor's conversation at once and both tried to
 * create it. Thrown by the repository on the `message_threads_warehouse_key`
 * unique violation; the service resolves it by reading the winner's row rather
 * than surfacing an error, since "get or create" is what both callers wanted.
 */
export class ThreadAlreadyExistsError extends Error {
  constructor(readonly warehouseId: string) {
    super("A conversation already exists for this warehouse.");
    this.name = "ThreadAlreadyExistsError";
  }
}
