import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { decrypt } from "@cadeau/crypto";
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
import type {
  CompanyRecord,
  InvitationRecord,
  MembershipCompany,
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

/**
 * Orchestrates tenancy: the caller's profile view, the companies they belong to,
 * company creation + tenant switching (delegating token re-issue to
 * {@link AuthService}), and invitation lifecycle. The active tenant always comes
 * from the token/principal, never the client payload (ADR-003); path company ids
 * on tenant-scoped operations must match it.
 */
@Injectable()
export class TenancyService {
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
      phone:
        profile.phoneEncrypted === null
          ? null
          : decrypt(profile.phoneEncrypted, this.config.encryption.key),
      twoFactorEnabled: profile.totpEnabledAt !== null,
      activeCompanyId: principal.companyId,
      companies,
    };
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

  /** Invite a member to the caller's active company. Returns the one-time code. */
  async createInvitation(
    principal: RequestPrincipal,
    companyId: string,
    input: { readonly email: string; readonly role: string },
  ): Promise<CreatedInvitation> {
    await this.assertActiveTenant(principal, companyId);
    const code = randomBytes(32).toString("base64url");
    const invitation = await this.repo.createInvitation({
      companyId,
      email: input.email,
      role: input.role,
      codeHash: hashCode(code),
      expiresAt: new Date(this.clock.now() + INVITATION_TTL_MS),
      actorId: principal.userId,
    });
    this.audit.record("member.invited", {
      userId: principal.userId,
      companyId,
      invitationId: invitation.id,
      email: input.email,
      role: input.role,
    });
    return { invitation, code };
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

  /** Accept an invitation by its code, joining the company. */
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
      email: profile.email,
    });
    switch (outcome.kind) {
      case "invalid":
        // Generic 404 so a bad code cannot be distinguished from an expired/
        // revoked one (no invitation enumeration).
        throw AppErrors.notFound("Invitation is invalid or has expired.");
      case "email_mismatch":
        throw AppErrors.forbidden("This invitation was issued to a different email.");
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
   * Require the path company to be the caller's active tenant AND the caller to
   * be an active member of it (ADR-003: the tenant comes from the token; the path
   * only names it). Defends the tenant-scoped write path independently of RLS.
   */
  private async assertActiveTenant(principal: RequestPrincipal, companyId: string): Promise<void> {
    if (principal.companyId === null || principal.companyId !== companyId) {
      throw AppErrors.forbidden("Select this company as your active tenant first.");
    }
    const membership = await this.repo.findActiveMembership(principal.userId, companyId);
    if (membership === null) {
      throw AppErrors.forbidden("You are not an active member of that company.");
    }
  }
}

/** SHA-256 hex hash of an invite code — what we persist and look up by. */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
