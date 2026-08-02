import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../shared/time/clock";

/** Bosta's city/district catalog changes rarely — cache it for a few hours. */
export const BOSTA_CATALOG_TTL_MS = 4 * 60 * 60 * 1000;

interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

/**
 * A small in-process cache for Bosta's public `/cities` and
 * `/cities/{id}/districts` lookups (Phase C — the address-mapping picker),
 * so opening the picker on ten customer addresses doesn't hit Bosta ten
 * times. Same single-process, short-TTL trade-off as {@link MasterDataCache}
 * (no Redis in this stack).
 */
@Injectable()
export class BostaCatalogCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  get<T>(key: string): T | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    this.entries.set(key, { value, expiresAt: this.clock.now() + BOSTA_CATALOG_TTL_MS });
  }
}
