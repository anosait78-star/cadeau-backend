/**
 * Order review domain errors. Thrown by the domain/repository and mapped to
 * the api-conventions error envelope by the application service — so the
 * domain never depends on HTTP.
 */

/**
 * The order already has a review — reviews are create-only, no update path.
 * Thrown by the repository on the `order_reviews_order_key` unique-violation
 * race (the service's own pre-check catches the non-concurrent case earlier).
 */
export class ReviewAlreadyExistsError extends Error {
  constructor(readonly orderId: string) {
    super("This order has already been reviewed.");
    this.name = "ReviewAlreadyExistsError";
  }
}
