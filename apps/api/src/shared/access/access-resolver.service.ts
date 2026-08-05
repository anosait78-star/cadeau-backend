import { Inject, Injectable } from "@nestjs/common";
import type { RequestPrincipal } from "../auth/authenticated-request";
import { ACCESS_REPOSITORY, type AccessRepositoryPort } from "./access-repository.port";
import { CapabilityCache } from "./capability-cache";
import {
  EMPTY_CAPABILITIES,
  type EffectiveCapabilities,
  resolveCapabilities,
} from "./capabilities";

/**
 * The central Access Resolver (ADR-0003). Resolves a principal's effective
 * capabilities across the three layers (Subscription ∧ Feature-Flag ∧
 * Permission), caching the result per (company, user). A principal with no
 * active tenant has no capabilities — the resolver short-circuits without a DB
 * read. This is the single source consulted by the API guards, the
 * `/access/capabilities` endpoint, and (indirectly) the web gates.
 */
@Injectable()
export class AccessResolverService {
  constructor(
    @Inject(ACCESS_REPOSITORY) private readonly repo: AccessRepositoryPort,
    private readonly cache: CapabilityCache,
  ) {}

  /** The caller's effective capabilities (cached). Empty when there is no active tenant. */
  async resolve(principal: RequestPrincipal): Promise<EffectiveCapabilities> {
    const { companyId, userId } = principal;
    if (companyId === null) return EMPTY_CAPABILITIES;

    const cached = this.cache.get(companyId, userId);
    if (cached !== null) return cached;

    const data = await this.repo.loadAccessData(userId, companyId);
    const caps = resolveCapabilities(data);
    this.cache.set(companyId, userId, caps);
    return caps;
  }
}
