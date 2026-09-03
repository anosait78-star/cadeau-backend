import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { decrypt, EncryptionError } from "@cadeau/crypto";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import {
  SESSION_REISSUE,
  type SessionReissuePort,
} from "../../../shared/contracts/session-reissue.port";
import type { TokenPair } from "../../../shared/contracts/token-pair";
import { AppErrors } from "../../../shared/errors/app-exception";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import { TENANCY_AUDIT, type TenancyAuditPort } from "../domain/tenancy-audit.port";
import { TENANCY_REPOSITORY, type TenancyRepositoryPort } from "../domain/tenancy-repository.port";
import { SlugAlreadyTakenError } from "../domain/tenancy.errors";
import { CUSTOM_ROLE, MANAGER_ROLE, OWNER_ROLE } from "../domain/tenancy-roles";
import type {
  CompanyRecord,
  InvitationRecord,
  MembershipCompany,
  MemberView,
  MeView,
} from "../domain/tenancy.types";

/** Invite validity window: 7 days. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Free trial granted to every newly created company: 30 days. */
const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** A created company plus the re-issued tenant-scoped token pair. */
export interface CreateCompanyResult {
  readonly company: CompanyRecord;
  readonly tokens: TokenPair;
}

/** A created invitation plus its one-time shareable code. */
export interface CreatedInvitation {
  readonly invitation: InvitationRecord;
  readonly code: string;
}

/** Outcome of accepting an invite. */
export interface AcceptInvitationResult {
  readonly companyId: string;
  readonly role: string;
  readonly alreadyMember: boolean;
}

/** Outcome of accepting a warehouse join code (Vendor Accounts, Phase 1). */
export interface AcceptWarehouseJoinCodeResult {
  readonly companyId: string;
  readonly role: string;
  readonly warehouseId: string | null;
  readonly alreadyMember: boolean;
}

/**
 * Orchestrates tenancy: the caller's profile view, the companies they belong to,
 * company creation + tenant switching (delegating token re-issue to
 * {@link AuthService}), and invitation lifecycle. The active tenant always comes
 * from the token/principal, never the client payload (ADR-003); path company ids
 * on tenant-scoped operations must match it.
 */
@Injectable()
export class TenancyService {
  private readonly logger = new Logger(TenancyService.name);

  constructor(
    @Inject(TENANCY_REPOSITORY) private readonly repo: TenancyRepositoryPort,
    @Inject(TENANCY_AUDIT) private readonly audit: TenancyAuditPort,
    @Inject(APP_CONFIG) private readonly config: InjectedAppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SESSION_REISSUE) private readonly sessions: SessionReissuePort,
  ) {}

  /** The caller's profile (PII decrypted for the owner) + their companies. */
  async getMe(principal: RequestPrincipal): Promise<MeView> {
    const profile = await this.repo.findProfile(principal.userId);
    if (profile === null) {
      throw AppErrors.unauthorized();
    }
    const companies = await this.repo.listUserCompanies(principal.userId);
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      phone: this.decryptProfilePhone(profile.id, profile.phoneEncrypted),
      twoFactorEnabled: profile.totpEnabledAt !== null,
      activeCompanyId: principal.companyId,
      companies,
    };
  }

  /**
   * Decrypt the profile phone for `/v1/me`. A row written before a key
   * rotation can no longer be decrypted with the current key — that must not
   * take down the whole login/session-bootstrap call, so a decrypt failure is
   * logged and degrades to `null` (the same shape as "no phone on file")
   * instead of throwing.
   */
  private decryptProfilePhone(userId: string, phoneEncrypted: string | null): string | null {
    if (phoneEncrypted === null) return null;
    try {
      return decrypt(phoneEncrypted, this.config.encryption.key);
    } catch (error) {
      if (error instanceof EncryptionError) {
        this.logger.warn(`Could not decrypt profile ${userId} phone: ${error.message}`);
        return null;
      }
      throw error;
    }
  }

  /** Companies the caller belongs to. */
  listCompanies(principal: RequestPrincipal): Promise<MembershipCompany[]> {
    return this.repo.listUserCompanies(principal.userId);
  }

  /** Create a company (caller becomes its owner) and switch the session into it. */
  async createCompany(
    principal: RequestPrincipal,
    input: {
      readonly name: string;
      readonly slug: string | null;
      readonly phone: string;
      readonly monthlyOrdersRange: string;
      readonly country: string | null;
      readonly facebookHandle: string | null;
      readonly instagramHandle: string | null;
      readonly websiteUrl: string | null;
      readonly shippingCarrier: string | null;
    },
  ): Promise<CreateCompanyResult> {
    const companyId = randomUUID();
    let company: CompanyRecord;
    try {
      company = await this.repo.createCompanyWithOwner({
        companyId,
        name: input.name,
        slug: input.slug,
        userId: principal.userId,
        phone: input.phone,
        monthlyOrdersRange: input.monthlyOrdersRange,
        country: input.country,
        facebookHandle: input.facebookHandle,
        instagramHandle: input.instagramHandle,
        websiteUrl: input.websiteUrl,
        shippingCarrier: input.shippingCarrier,
        trialEndsAt: new Date(this.clock.now() + TRIAL_DURATION_MS),
      });
    } catch (error) {
      if (error instanceof SlugAlreadyTakenError) {
        throw AppErrors.conflict(error.message);
      }
      throw error;
    }
    this.audit.record("company.created", { userId: principal.userId, companyId });
    const tokens = await this.sessions.reissueForCompany(principal, companyId);
    return { company, tokens };
  }

  /** Switch the active tenant to another company the caller is an active member of. */
  async switchCompany(principal: RequestPrincipal, companyId: string): Promise<TokenPair> {
    const membership = await this.repo.findActiveMembership(principal.userId, companyId);
    if (membership === null) {
      throw AppErrors.forbidden("You are not an active member of that company.");
    }
    return this.sessions.reissueForCompany(principal, companyId);
  }

  /** Update the caller's active company's WhatsApp dialing-prefix setting. */
  async updateWhatsappSettings(
    principal: RequestPrincipal,
    companyId: string,
    countryCode: string | null,
  ): Promise<CompanyRecord> {
    await this.assertActiveTenant(principal, companyId);
    const company = await this.repo.updateWhatsappCountryCode(
      companyId,
      principal.userId,
      countryCode,
    );
    if (company === null) {
      throw AppErrors.notFound("Company not found.");
    }
    this.audit.record("company.whatsapp_settings_updated", {
      userId: principal.userId,
      companyId,
    });
    return company;
  }

  /**
   * Invite a member to the caller's active company. Returns the one-time code.
   * The route itself requires `access.manage` (controller guard); this method
   * additionally enforces:
   *
   * - **Owner invitations**: the permission catalog has no dedicated "manage
   *   owners" capability — `access.manage` is the same single gate used for
   *   every other role. Granting a brand-new Owner is irreversible-by-a-lesser-
   *   role and strictly more sensitive than any other template, so — in the
   *   absence of a purpose-built permission — the safest rule available from
   *   the existing model is enforced here: only a caller whose OWN active
   *   membership role is already `"owner"` may invite another Owner. This is a
   *   deliberate, documented gap-fill, not a new permission in the catalog.
   * - **Custom role**: grants exactly `permissionKeys` for this invitation
   *   alone — never a reusable role. The chosen keys are re-validated here
   *   against what the company's plan/features actually make available; the
   *   caller's payload is never trusted as-is (defense in depth alongside any
   *   DTO-level shape checks).
   */
  async createInvitation(
    principal: RequestPrincipal,
    companyId: string,
    input: {
      readonly role: string;
      readonly permissionKeys?: readonly string[];
    },
  ): Promise<CreatedInvitation> {
    const membership = await this.assertActiveTenant(principal, companyId);
    if (input.role === OWNER_ROLE && membership.role !== OWNER_ROLE) {
      throw AppErrors.forbidden("Only an existing Owner can invite another Owner.");
    }
    const customPermissionKeys = await this.resolveCustomPermissionKeys(companyId, input);

    const code = randomBytes(32).toString("base64url");
    const invitation = await this.repo.createInvitation({
      companyId,
      role: input.role,
      customPermissionKeys,
      codeHash: hashCode(code),
      expiresAt: new Date(this.clock.now() + INVITATION_TTL_MS),
      actorId: principal.userId,
    });
    this.audit.record("member.invited", {
      userId: principal.userId,
      companyId,
      invitationId: invitation.id,
      role: input.role,
    });
    return { invitation, code };
  }

  /**
   * Validate and normalize the invitation's extra permission-key overlay.
   * `"custom"` requires a non-empty set (it has no template to fall back on);
   * `"manager"` may optionally layer extra keys (e.g. `access.manage`) on top
   * of its template; every other role disallows the field entirely. Not part
   * of the public surface — pulled out only to keep {@link createInvitation}
   * short.
   */
  private async resolveCustomPermissionKeys(
    companyId: string,
    input: { readonly role: string; readonly permissionKeys?: readonly string[] },
  ): Promise<string[]> {
    const requested = input.permissionKeys ?? [];

    if (input.role !== CUSTOM_ROLE && input.role !== MANAGER_ROLE) {
      if (requested.length > 0) {
        throw AppErrors.validation(
          'permissionKeys is only allowed when role is "custom" or "manager".',
        );
      }
      return [];
    }

    const unique = [...new Set(requested)];
    if (unique.length === 0) {
      if (input.role === CUSTOM_ROLE) {
        throw AppErrors.validation(
          'permissionKeys is required and must be non-empty for role "custom".',
        );
      }
      return [];
    }

    const available = new Set(await this.repo.listCompanyAvailablePermissionKeys(companyId));
    const invalid = unique.filter((key) => !available.has(key));
    if (invalid.length > 0) {
      throw AppErrors.validation(
        `These permissions are not available to your company: ${invalid.join(", ")}.`,
        { invalidPermissionKeys: invalid },
      );
    }
    return unique;
  }

  /** Revoke a pending invitation in the caller's active company. */
  async revokeInvitation(
    principal: RequestPrincipal,
    companyId: string,
    invitationId: string,
  ): Promise<void> {
    await this.assertActiveTenant(principal, companyId);
    const revoked = await this.repo.revokeInvitation({
      companyId,
      invitationId,
      actorId: principal.userId,
    });
    if (!revoked) {
      throw AppErrors.notFound("Invitation not found.");
    }
    this.audit.record("member.invite_revoked", {
      userId: principal.userId,
      companyId,
      invitationId,
    });
  }

  /** List invitations (any status) for the caller's active company, newest first. */
  async listInvitations(
    principal: RequestPrincipal,
    companyId: string,
  ): Promise<InvitationRecord[]> {
    await this.assertActiveTenant(principal, companyId);
    return this.repo.listInvitations(companyId);
  }

  /** List active members of the caller's active company. */
  async listMembers(principal: RequestPrincipal, companyId: string): Promise<MemberView[]> {
    await this.assertActiveTenant(principal, companyId);
    return this.repo.listMembers(companyId);
  }

  /**
   * Remove a member from the caller's active company. Refuses to remove the
   * last Owner, and (mirroring `createInvitation`'s invite-side rule) refuses
   * to remove an Owner at all unless the caller is themselves an Owner.
   */
  async removeMember(
    principal: RequestPrincipal,
    companyId: string,
    memberId: string,
  ): Promise<void> {
    await this.assertActiveTenant(principal, companyId);
    const outcome = await this.repo.removeMember({
      companyId,
      memberId,
      actorId: principal.userId,
    });
    switch (outcome.kind) {
      case "not_found":
        throw AppErrors.notFound("Member not found.");
      case "not_owner":
        throw AppErrors.forbidden("Only an existing Owner can remove another Owner.");
      case "last_owner":
        throw AppErrors.conflict("Cannot remove the company's last owner.");
      case "removed":
        this.audit.record("member.removed", {
          userId: principal.userId,
          companyId,
          memberId,
        });
        return;
    }
  }

  /**
   * Accept an invitation by its code, joining the company. The code is the
   * whole credential: it is issued to whoever the inviter shares it with, and
   * the invitee signs up with their own address, so there is no email to match
   * against. Bounded by the invitation's expiry and revocability instead.
   */
  async acceptInvitation(
    principal: RequestPrincipal,
    code: string,
  ): Promise<AcceptInvitationResult> {
    const profile = await this.repo.findProfile(principal.userId);
    if (profile === null) {
      throw AppErrors.unauthorized();
    }
    const outcome = await this.repo.acceptInvitationByCode({
      codeHash: hashCode(code),
      userId: principal.userId,
    });
    switch (outcome.kind) {
      case "invalid":
        // Generic 404 so a bad code cannot be distinguished from an expired/
        // revoked one (no invitation enumeration).
        throw AppErrors.notFound("Invitation is invalid or has expired.");
      case "already_member":
        return { companyId: outcome.companyId, role: outcome.role, alreadyMember: true };
      case "accepted":
        this.audit.record("member.joined", {
          userId: principal.userId,
          companyId: outcome.companyId,
          role: outcome.role,
        });
        return { companyId: outcome.companyId, role: outcome.role, alreadyMember: false };
    }
  }

  /**
   * Accept a warehouse join code, joining the company as a `"vendor"` member
   * scoped to that code's warehouse (Vendor Accounts, Phase 1). Mirrors
   * {@link acceptInvitation}'s shape (generic 404 so a bad code cannot be
   * distinguished from an inactive one; idempotent already-member), scoped to
   * one warehouse.
   */
  async joinWarehouseByCode(
    principal: RequestPrincipal,
    code: string,
  ): Promise<AcceptWarehouseJoinCodeResult> {
    const profile = await this.repo.findProfile(principal.userId);
    if (profile === null) {
      throw AppErrors.unauthorized();
    }
    const outcome = await this.repo.acceptWarehouseJoinCodeByCode({
      codeHash: hashCode(code),
      userId: principal.userId,
    });
    switch (outcome.kind) {
      case "invalid":
        // Generic 404 so a bad code cannot be distinguished from a revoked
        // one (no code enumeration).
        throw AppErrors.notFound("Join code is invalid.");
      case "already_member":
        return {
          companyId: outcome.companyId,
          role: outcome.role,
          warehouseId: outcome.warehouseId,
          alreadyMember: true,
        };
      case "accepted":
        this.audit.record("member.joined_via_warehouse_code", {
          userId: principal.userId,
          companyId: outcome.companyId,
          warehouseId: outcome.warehouseId,
        });
        return {
          companyId: outcome.companyId,
          role: outcome.role,
          warehouseId: outcome.warehouseId,
          alreadyMember: false,
        };
    }
  }

  /**
   * Require the path company to be the caller's active tenant AND the caller to
   * be an active member of it (ADR-003: the tenant comes from the token; the path
   * only names it). Defends the tenant-scoped write path independently of RLS —
   * this check runs regardless of any capability guard on the route, so a
   * `@RequireCapability` gate is additive, never a substitute for it. Returns
   * the caller's own membership so callers that need it (e.g. the Owner-invite
   * rule below) don't re-query.
   */
  private async assertActiveTenant(
    principal: RequestPrincipal,
    companyId: string,
  ): Promise<{ readonly role: string }> {
    if (principal.companyId === null || principal.companyId !== companyId) {
      throw AppErrors.forbidden("Select this company as your active tenant first.");
    }
    const membership = await this.repo.findActiveMembership(principal.userId, companyId);
    if (membership === null) {
      throw AppErrors.forbidden("You are not an active member of that company.");
    }
    return membership;
  }
}

/** SHA-256 hex hash of an invite code — what we persist and look up by. */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
