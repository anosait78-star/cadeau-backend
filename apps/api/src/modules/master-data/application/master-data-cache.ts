import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import type { ResourceView } from "../domain/resource.types";

/** Time-to-live for a cached reference set. Bounds staleness after a change. */
export const MASTER_DATA_TTL_MS = 60_000;

interface CacheEntry {
  readonly rows: readonly ResourceView[];
  readonly expiresAt: number;
}

/**
 * A small in-process cache of active reference rows, keyed by
 * `resource:scope` (scope is the companyId for tenant resources, or `system`).
 * Master data is read far more than it changes and later modules resolve against
 * it on hot paths, so caching keeps those lookups cheap; the short TTL plus
 * explicit invalidation on every write bounds staleness. Single-process by
 * design (no Redis in the stack), same trade-off as {@link CapabilityCache}.
 */
@Injectable()
export class MasterDataCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  private static key(resource: string, scope: string): string {
    return `${resource}:${scope}`;
  }

  /** The cached active set, or `null` when absent or expired. */
  get(resource: string, scope: string): readonly ResourceView[] | null {
    const entry = this.entries.get(MasterDataCache.key(resource, scope));
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.entries.delete(MasterDataCache.key(resource, scope));
      return null;
    }
    return entry.rows;
  }

  /** Cache an active set with the standard TTL. */
  set(resource: string, scope: string, rows: readonly ResourceView[]): void {
    this.entries.set(MasterDataCache.key(resource, scope), {
      rows,
      expiresAt: this.clock.now() + MASTER_DATA_TTL_MS,
    });
  }

  /** Drop one resource's cached set for a scope (after a write). */
  invalidate(resource: string, scope: string): void {
    this.entries.delete(MasterDataCache.key(resource, scope));
  }

  /** Drop everything (used by tests). */
  clear(): void {
    this.entries.clear();
  }
}
