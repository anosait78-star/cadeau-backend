import { Inject, Injectable } from "@nestjs/common";
import { InvalidCursorError, type KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { eventActorId } from "../../../shared/auth/system-principal";
import { AppErrors } from "../../../shared/errors/app-exception";
import { withErrorMapping } from "../../../shared/errors/with-error-mapping";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import {
  isPayoutMethod,
  type LedgerEntryView,
  type PayoutView,
  type VendorBalanceView,
} from "../domain/vendor-payout.entity";
import {
  VENDOR_PAYOUTS_AUDIT,
  type VendorPayoutsAuditPort,
} from "../domain/vendor-payouts-audit.port";
import {
  VENDOR_PAYOUTS_REPOSITORY,
  type PageQuery,
  type VendorPayoutsRepositoryPort,
} from "../domain/vendor-payouts-repository.port";
import {
  IdempotencyKeyReusedError,
  NothingToPayError,
  PayoutAlreadyPendingError,
  PayoutNotFoundError,
  PayoutNotPendingError,
  PayoutPeriodClosedError,
  VendorNotFoundError,
} from "../domain/vendor-payouts.errors";

/** Raw list params as they arrive on the query string. */
export interface RawPageQuery {
  readonly limit?: string;
  readonly cursor?: string;
}

export interface RequestPayoutCommand {
  readonly method: string;
  readonly reference?: string | null;
  readonly notes?: string | null;
  readonly idempotencyKey: string | undefined;
}

export interface AdjustmentCommand {
  readonly amountMinor: number;
  readonly note: string;
}

/** Longest accepted `Idempotency-Key` (matches the other money-moving routes). */
const MAX_IDEMPOTENCY_KEY = 200;

/**
 * Vendor payouts (2026-11-17): what each vendor is owed, and settling it.
 *
 * Two audiences, one service:
 *
 * - **Company staff** (`vendor_payouts.read` / `.manage`, enforced by the
 *   guard) see every vendor, request payouts, cancel them, force a
 *   confirmation with a written reason, and post manual adjustments.
 * - **A vendor** (`vendor_payouts.read`, warehouse-scoped) sees only their own
 *   account and confirms receipt of their own pending payout. Their warehouse
 *   comes from their membership, resolved fresh on every call — never from
 *   the request — and the RLS policies confine them independently.
 *
 * Every write is audited (ids and amounts only) and emits a domain event after
 * it commits, which the notifications module turns into the other side's
 * notification.
 */
@Injectable()
export class VendorPayoutsService {
  constructor(
    @Inject(VENDOR_PAYOUTS_REPOSITORY) private readonly repo: VendorPayoutsRepositoryPort,
    @Inject(VENDOR_PAYOUTS_AUDIT) private readonly audit: VendorPayoutsAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---- company side --------------------------------------------------------

  async listVendors(principal: RequestPrincipal): Promise<readonly VendorBalanceView[]> {
    const companyId = await this.requireStaff(principal);
    return this.repo.listVendorBalances(companyId, principal.userId);
  }

  async getVendor(principal: RequestPrincipal, warehouseId: string): Promise<VendorBalanceView> {
    const companyId = await this.requireStaff(principal);
    const balance = await this.repo.getVendorBalance(companyId, principal.userId, warehouseId);
    if (balance === null) throw AppErrors.notFound("Vendor not found.");
    return balance;
  }

  async listVendorLedger(
    principal: RequestPrincipal,
    warehouseId: string,
    raw: RawPageQuery,
  ): Promise<KeysetPage<LedgerEntryView>> {
    const companyId = await this.requireStaff(principal);
    return withErrorMapping(
      () => this.repo.listLedger(companyId, principal.userId, warehouseId, this.page(raw)),
      (error) => this.mapError(error),
    );
  }

  async listCompanyPayouts(
    principal: RequestPrincipal,
    warehouseId: string | undefined,
    raw: RawPageQuery,
  ): Promise<KeysetPage<PayoutView>> {
    const companyId = await this.requireStaff(principal);
    return withErrorMapping(
      () => this.repo.listPayouts(companyId, principal.userId, warehouseId ?? null, this.page(raw)),
      (error) => this.mapError(error),
    );
  }

  /**
   * Ask to pay a vendor everything owed right now (decision 2: no partial
   * payouts). `Idempotency-Key` is mandatory — a retried click replays the
   * first payout instead of creating a second one.
   */
  async requestPayout(
    principal: RequestPrincipal,
    warehouseId: string,
    command: RequestPayoutCommand,
  ): Promise<{ readonly payout: PayoutView; readonly replayed: boolean }> {
    const companyId = await this.requireStaff(principal);
    const idempotencyKey = command.idempotencyKey?.trim() ?? "";
    if (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
      throw AppErrors.validation("Request validation failed", [
        {
          field: "Idempotency-Key",
          messages: ["An Idempotency-Key header (1–200 characters) is required."],
        },
      ]);
    }
    const method = command.method;
    if (!isPayoutMethod(method)) {
      throw AppErrors.validation("Request validation failed", [
        { field: "method", messages: ["method is not a recognized payout method."] },
      ]);
    }
    const result = await withErrorMapping(
      () =>
        this.repo.createPayout(
          { companyId, actorId: principal.userId },
          {
            warehouseId,
            method,
            reference: command.reference ?? null,
            notes: command.notes ?? null,
            idempotencyKey,
          },
        ),
      (error) => this.mapError(error),
    );
    if (result.replayed) return result;

    const { payout } = result;
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "vendor_payout.requested",
      entityType: "vendor_payout",
      entityId: payout.id,
      changes: {
        warehouseId: payout.warehouseId,
        amountMinor: payout.amountMinor,
        method: payout.method,
        entryCount: payout.entryCount,
      },
    });
    await this.events.publish({
      type: "vendor_payout.requested",
      companyId,
      actorId: eventActorId(principal),
      occurredAt: this.clock.now(),
      payload: {
        payoutId: payout.id,
        warehouseId: payout.warehouseId,
        amountMinor: payout.amountMinor,
      },
    });
    return result;
  }

  /** Withdraw a pending payout; its rows are owed again. */
  async cancelPayout(principal: RequestPrincipal, payoutId: string): Promise<PayoutView> {
    const companyId = await this.requireStaff(principal);
    const payout = await withErrorMapping(
      () => this.repo.cancelPayout({ companyId, actorId: principal.userId }, payoutId),
      (error) => this.mapError(error),
    );
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "vendor_payout.cancelled",
      entityType: "vendor_payout",
      entityId: payout.id,
      changes: { warehouseId: payout.warehouseId, amountMinor: payout.amountMinor },
    });
    await this.events.publish({
      type: "vendor_payout.cancelled",
      companyId,
      actorId: eventActorId(principal),
      occurredAt: this.clock.now(),
      payload: { payoutId: payout.id, warehouseId: payout.warehouseId },
    });
    return payout;
  }

  /**
   * Confirm a payout on the vendor's behalf (decision 7) — for a vendor who
   * received the money but never pressed the button. The reason is mandatory,
   * stored on the payout, and shown to the vendor.
   */
  async forceConfirmPayout(
    principal: RequestPrincipal,
    payoutId: string,
    reason: string,
  ): Promise<PayoutView> {
    const companyId = await this.requireStaff(principal);
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw AppErrors.validation("Request validation failed", [
        { field: "reason", messages: ["A reason of at least 3 characters is required."] },
      ]);
    }
    const payout = await withErrorMapping(
      () =>
        this.repo.confirmPayout({ companyId, actorId: principal.userId }, payoutId, {
          kind: "forced",
          reason: trimmed,
        }),
      (error) => this.mapError(error),
    );
    await this.recordConfirmation(principal, companyId, payout);
    return payout;
  }

  /**
   * A manual correction (decision 5: exchanges; decision 6: opening balances;
   * decision 9: anything that changed after delivery). Positive raises what
   * the company owes, negative lowers it.
   */
  async createAdjustment(
    principal: RequestPrincipal,
    warehouseId: string,
    command: AdjustmentCommand,
  ): Promise<LedgerEntryView> {
    const companyId = await this.requireStaff(principal);
    const note = command.note.trim();
    if (!Number.isSafeInteger(command.amountMinor) || command.amountMinor === 0) {
      throw AppErrors.validation("Request validation failed", [
        { field: "amountMinor", messages: ["amountMinor must be a non-zero whole number."] },
      ]);
    }
    if (note.length < 3) {
      throw AppErrors.validation("Request validation failed", [
        { field: "note", messages: ["A note of at least 3 characters is required."] },
      ]);
    }
    const entry = await withErrorMapping(
      () =>
        this.repo.createAdjustment(
          { companyId, actorId: principal.userId },
          { warehouseId, amountMinor: command.amountMinor, note },
        ),
      (error) => this.mapError(error),
    );
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "vendor_ledger.adjusted",
      entityType: "vendor_ledger_entry",
      entityId: entry.id,
      changes: { warehouseId, amountMinor: entry.amountMinor, noteLength: note.length },
    });
    return entry;
  }

  // ---- vendor side ---------------------------------------------------------

  async getMyAccount(principal: RequestPrincipal): Promise<VendorBalanceView> {
    const { companyId, warehouseId } = await this.requireVendor(principal);
    const balance = await this.repo.getVendorBalance(companyId, principal.userId, warehouseId);
    if (balance === null) throw AppErrors.notFound("Vendor account not found.");
    return balance;
  }

  async listMyLedger(
    principal: RequestPrincipal,
    raw: RawPageQuery,
  ): Promise<KeysetPage<LedgerEntryView>> {
    const { companyId, warehouseId } = await this.requireVendor(principal);
    return withErrorMapping(
      () => this.repo.listLedger(companyId, principal.userId, warehouseId, this.page(raw)),
      (error) => this.mapError(error),
    );
  }

  async listMyPayouts(
    principal: RequestPrincipal,
    raw: RawPageQuery,
  ): Promise<KeysetPage<PayoutView>> {
    const { companyId, warehouseId } = await this.requireVendor(principal);
    return withErrorMapping(
      () => this.repo.listPayouts(companyId, principal.userId, warehouseId, this.page(raw)),
      (error) => this.mapError(error),
    );
  }

  /** "استلمت المبلغ": the vendor confirms their own pending payout, settling it. */
  async confirmMyPayout(principal: RequestPrincipal, payoutId: string): Promise<PayoutView> {
    const { companyId, warehouseId } = await this.requireVendor(principal);
    const payout = await withErrorMapping(
      () =>
        this.repo.confirmPayout({ companyId, actorId: principal.userId }, payoutId, {
          kind: "vendor",
          warehouseId,
        }),
      (error) => this.mapError(error),
    );
    await this.recordConfirmation(principal, companyId, payout);
    return payout;
  }

  // ---- internals -----------------------------------------------------------

  private async recordConfirmation(
    principal: RequestPrincipal,
    companyId: string,
    payout: PayoutView,
  ): Promise<void> {
    const confirmationKind = payout.confirmationKind ?? "vendor";
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "vendor_payout.confirmed",
      entityType: "vendor_payout",
      entityId: payout.id,
      changes: {
        warehouseId: payout.warehouseId,
        amountMinor: payout.amountMinor,
        confirmationKind,
        forceReasonLength: payout.forceReason?.length ?? 0,
      },
    });
    await this.events.publish({
      type: "vendor_payout.confirmed",
      companyId,
      actorId: eventActorId(principal),
      occurredAt: this.clock.now(),
      payload: {
        payoutId: payout.id,
        warehouseId: payout.warehouseId,
        amountMinor: payout.amountMinor,
        confirmationKind,
      },
    });
  }

  /**
   * A company-side caller: a member of the tenant with no warehouse scope. A
   * vendor holding `vendor_payouts.read` must never reach the company routes,
   * which would show every other vendor — so the scope is checked here as
   * well as by the RLS policy.
   */
  private async requireStaff(principal: RequestPrincipal): Promise<string> {
    const companyId = this.requireTenant(principal);
    const scope = await this.repo.findMemberScope(companyId, principal.userId);
    if (scope === null) throw AppErrors.forbidden("You are not a member of this company.");
    if (scope.warehouseId !== null) throw AppErrors.forbidden("Vendors cannot use this route.");
    return companyId;
  }

  /** A vendor caller and the one warehouse they are scoped to. */
  private async requireVendor(
    principal: RequestPrincipal,
  ): Promise<{ readonly companyId: string; readonly warehouseId: string }> {
    const companyId = this.requireTenant(principal);
    const scope = await this.repo.findMemberScope(companyId, principal.userId);
    if (scope === null || scope.warehouseId === null) {
      throw AppErrors.notFound("Vendor account not found.");
    }
    return { companyId, warehouseId: scope.warehouseId };
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private page(raw: RawPageQuery): PageQuery {
    return {
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
      ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
    };
  }

  private mapError(error: unknown): unknown {
    if (error instanceof VendorNotFoundError) return AppErrors.notFound(error.message);
    if (error instanceof PayoutNotFoundError) return AppErrors.notFound(error.message);
    if (error instanceof PayoutAlreadyPendingError || error instanceof IdempotencyKeyReusedError) {
      return AppErrors.conflict(error.message);
    }
    if (error instanceof PayoutNotPendingError) {
      return AppErrors.conflict(error.message, [{ field: "status", messages: [error.message] }]);
    }
    if (error instanceof NothingToPayError || error instanceof PayoutPeriodClosedError) {
      return AppErrors.unprocessable(error.message);
    }
    if (error instanceof InvalidCursorError) return AppErrors.badRequest("Invalid cursor.");
    return error;
  }
}
