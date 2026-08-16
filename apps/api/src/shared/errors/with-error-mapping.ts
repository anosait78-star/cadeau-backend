/**
 * Run `fn`, rethrowing any error passed through `mapError` first. Consolidates
 * the `try { ... } catch (error) { throw this.mapError(error); }` wrapper that
 * previously appeared verbatim around write methods in every application
 * service — each service still owns its own `mapError` dispatch table, this
 * only removes the repeated try/catch shape around it.
 */
export async function withErrorMapping<T>(
  fn: () => Promise<T>,
  mapError: (error: unknown) => unknown,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapError(error);
  }
}
