import { SetMetadata } from "@nestjs/common";
import type { CapabilityRequirement } from "./capabilities";

/** Metadata key under which {@link RequireCapability} stores its requirement. */
export const REQUIRE_CAPABILITY_KEY = "cadeau:require-capability";

/**
 * Gate a route by the three-layer access model. The {@link AccessGuard} resolves
 * the caller's effective capabilities and enforces the requirement: both the
 * `feature` and the `permission` (when given) must hold, else `403 FORBIDDEN`.
 * Apply alongside `JwtAuthGuard` (the requirement is meaningless without a
 * principal). Feature epics declare this on every gated handler.
 */
export const RequireCapability = (requirement: CapabilityRequirement): MethodDecorator =>
  SetMetadata(REQUIRE_CAPABILITY_KEY, requirement);
