import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../time/clock";
import type { EffectiveCapabilities } from "./capabilities";

/** Time-to-live for a cached capability set. Bounds staleness after a change. */
export const CAPABILITY_TTL_MS = 60_000;

interface CacheEntry {
  readonly caps: EffectiveCapabilities;
  readonly expiresAt: number;
}

/**
 * A small in-process cache of resolved capabilities, keyed by `company:user`.
 * Resolution touches several tables, so caching keeps gated requests cheap; the
 * short TTL plus explicit invalidation on every permission/flag/plan change
 * bounds staleness.
 *
 * Single-process by design (no Redis in the stack). Across multiple API
 * instances a change invalidates only the local process; the TTL is the upper
 * bound on how long another instance can serve a stale set. Acceptable for the
 * platform's scale; revisit with a shared cache if the API is horizontally
 * scaled with strict-consistency needs.
 */
@Injectable()
export class CapabilityCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  private static key(companyId: string, userId: string): string {
    return `${companyId}:${userId}`;
  }

  /** The cached set for a member, or null when absent or expired. */
  get(companyId: string, userId: string): EffectiveCapabilities | null {
    const entry = this.entries.get(CapabilityCache.key(companyId, userId));
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.entries.delete(CapabilityCache.key(companyId, userId));
      return null;
    }
    return entry.caps;
  }

  /** Cache a member's resolved set with the standard TTL. */
  set(companyId: string, userId: string, caps: EffectiveCapabilities): void {
    this.entries.set(CapabilityCache.key(companyId, userId), {
      caps,
      expiresAt: this.clock.now() + CAPABILITY_TTL_MS,
    });
  }

  /** Drop one member's cached set (e.g. after their permissions change). */
  invalidateMember(companyId: string, userId: string): void {
    this.entries.delete(CapabilityCache.key(companyId, userId));
  }

  /** Drop every cached set for a company (e.g. after a feature/plan change). */
  invalidateCompany(companyId: string): void {
    const prefix = `${companyId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /** Drop everything (used by tests). */
  clear(): void {
    this.entries.clear();
  }
}
