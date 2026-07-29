import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request data propagated implicitly through the async call tree. */
export interface RequestContext {
  /** Correlation id, echoed to clients via the `x-request-id` response header. */
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `callback` with the given request context bound for its async subtree. */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

/** The current request's context, or `undefined` outside any request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The current request's correlation id, or `undefined` outside any request. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
