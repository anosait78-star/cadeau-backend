import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { hashPassword } from "@cadeau/crypto";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import type {
  StorefrontConnectionView,
  StorefrontConnectionWithSecret,
  StorefrontPlatform,
} from "../domain/storefront-connection.entity";
import { STOREFRONT_AUDIT, type StorefrontAuditPort } from "../domain/storefront-audit.port";
import {
  STOREFRONT_CONNECTIONS_REPOSITORY,
  type StorefrontConnectionsRepositoryPort,
} from "../domain/storefront-connections-repository.port";
import { DuplicateConnectionLabelError, WarehouseNotFoundError } from "../domain/storefront.errors";

/** The API key's fixed textual prefix — makes a leaked key greppable/recognizable. */
const KEY_TAG = "sfk_";
/** Random bytes backing the secret portion of the key (256 bits). */
const KEY_ENTROPY_BYTES = 32;

/** Fields accepted when creating a connection (the plaintext key is minted here). */
export interface CreateConnectionCommand {
  readonly label: string;
  readonly platform?: StorefrontPlatform;
  readonly defaultWarehouseId?: string | null;
}

/** Partial update; omitted keys are left unchanged. */
export interface UpdateConnectionCommand {
  readonly label?: string;
  readonly defaultWarehouseId?: string | null;
  readonly status?: "active" | "paused";
}

/**
 * Orchestrates connection lifecycle management (storefront-integration §6.1,
 * D1/D2). Mints a high-entropy API key at create/rotate time, stores only its
 * scrypt hash (`@cadeau/crypto` `hashPassword`), and returns the plaintext
 * exactly once. Every write is recorded to the durable audit log. Access is
 * gated by the controller's `@RequireCapability({ feature:
 * "storefront_integration", permission: "integrations.manage" })`; this
 * service assumes an authorized caller.
 */
@Injectable()
export class StorefrontConnectionsService {
  constructor(
    @Inject(STOREFRONT_CONNECTIONS_REPOSITORY)
    private readonly repo: StorefrontConnectionsRepositoryPort,
    @Inject(STOREFRONT_AUDIT) private readonly audit: StorefrontAuditPort,
  ) {}

  async list(
    principal: RequestPrincipal,
    limit: number | undefined,
    cursor: string | undefined,
  ): Promise<KeysetPage<StorefrontConnectionView>> {
    const companyId = this.requireTenant(principal);
    return this.repo.list(companyId, limit ?? 25, cursor);
  }

  async getOne(principal: RequestPrincipal, id: string): Promise<StorefrontConnectionView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.findById(companyId, id);
    if (row === null) throw AppErrors.notFound("Connection not found.");
    return row;
  }

  async create(
    principal: RequestPrincipal,
    data: CreateConnectionCommand,
  ): Promise<StorefrontConnectionWithSecret> {
    const companyId = this.requireTenant(principal);
    const { plaintext, prefix, hash } = await this.mintKey();
    let connection: StorefrontConnectionView;
    try {
      connection = await this.repo.create(
        { companyId, actorId: principal.userId },
        {
          label: data.label,
          ...(data.platform === undefined ? {} : { platform: data.platform }),
          apiKeyHash: hash,
          apiKeyPrefix: prefix,
          ...(data.defaultWarehouseId === undefined
            ? {}
            : { defaultWarehouseId: data.defaultWarehouseId }),
        },
      );
    } catch (error) {
      throw this.mapError(error);
    }
    await this.record(companyId, principal.userId, {
      action: "storefront_connection.created",
      entityType: "storefront_connection",
      entityId: connection.id,
      changes: { label: connection.label, platform: connection.platform },
    });
    return { connection, apiKey: plaintext };
  }

  async update(
    principal: RequestPrincipal,
    id: string,
    data: UpdateConnectionCommand,
  ): Promise<StorefrontConnectionView> {
    const companyId = this.requireTenant(principal);
    let row: StorefrontConnectionView | null;
    try {
      row = await this.repo.update({ companyId, actorId: principal.userId }, id, data);
    } catch (error) {
      throw this.mapError(error);
    }
    if (row === null) throw AppErrors.notFound("Connection not found.");
    await this.record(companyId, principal.userId, {
      action: "storefront_connection.updated",
      entityType: "storefront_connection",
      entityId: row.id,
      changes: data,
    });
    return row;
  }

  async rotateKey(
    principal: RequestPrincipal,
    id: string,
  ): Promise<StorefrontConnectionWithSecret> {
    const companyId = this.requireTenant(principal);
    const { plaintext, prefix, hash } = await this.mintKey();
    const row = await this.repo.rotateKey(
      { companyId, actorId: principal.userId },
      id,
      hash,
      prefix,
    );
    if (row === null) throw AppErrors.notFound("Connection not found.");
    await this.record(companyId, principal.userId, {
      action: "storefront_connection.key_rotated",
      entityType: "storefront_connection",
      entityId: row.id,
    });
    return { connection: row, apiKey: plaintext };
  }

  async revoke(principal: RequestPrincipal, id: string): Promise<StorefrontConnectionView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.revoke({ companyId, actorId: principal.userId }, id);
    if (row === null) throw AppErrors.notFound("Connection not found.");
    await this.record(companyId, principal.userId, {
      action: "storefront_connection.revoked",
      entityType: "storefront_connection",
      entityId: row.id,
    });
    return row;
  }

  // ---- internals -----------------------------------------------------------

  private async mintKey(): Promise<{ plaintext: string; prefix: string; hash: string }> {
    const plaintext = `${KEY_TAG}${randomBytes(KEY_ENTROPY_BYTES).toString("base64url")}`;
    const prefix = plaintext.slice(0, 8);
    const hash = await hashPassword(plaintext);
    return { plaintext, prefix, hash };
  }

  private async record(
    companyId: string,
    actorId: string,
    fields: {
      action:
        | "storefront_connection.created"
        | "storefront_connection.updated"
        | "storefront_connection.key_rotated"
        | "storefront_connection.revoked";
      entityType: "storefront_connection";
      entityId: string;
      changes?: unknown;
    },
  ): Promise<void> {
    await this.audit.record({ companyId, actorId, ...fields });
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateConnectionLabelError) {
      return AppErrors.conflict(error.message, [{ field: "label", messages: [error.message] }]);
    }
    if (error instanceof WarehouseNotFoundError) {
      return AppErrors.unprocessable(error.message, [
        { field: "defaultWarehouseId", messages: [error.message] },
      ]);
    }
    return error;
  }
}
