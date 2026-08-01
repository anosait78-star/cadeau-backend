import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../shared/time/clock";

/** Time-to-live for a cached axis result (docs/epic-14-design.md, D2). */
export const ANALYTICS_CACHE_TTL_MS = 45_000;

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/**
 * A small in-process TTL cache for the analytics axes, keyed by
 * `companyId:axis:from:to:granularity` (EPIC-14, D2). Each axis is a
 * separately-cached, decomposed query per the contract — no monolithic
 * dashboard call, and a request for a different window/granularity is
 * always a fresh key, never a stale hit. Adapted from EPIC-5's
 * `CapabilityCache` idiom, but keyed by query parameters instead of by
 * member: analytics has no per-caller variance within a company, so the
 * cache is shared across every member of the same company requesting the
 * same window.
 *
 * Single-process by design (no Redis in the stack, matching every other
 * cache in this codebase) — the short TTL bounds staleness; there is no
 * explicit invalidation because analytics never writes anything that would
 * need to invalidate it.
 */
@Injectable()
export class AnalyticsCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  static key(companyId: string, axis: string, from: Date, to: Date, granularity: string): string {
    return `${companyId}:${axis}:${from.toISOString()}:${to.toISOString()}:${granularity}`;
  }

  get<T>(key: string): T | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: this.clock.now() + ANALYTICS_CACHE_TTL_MS });
  }

  /** Drop everything (used by tests). */
  clear(): void {
    this.entries.clear();
  }
}
