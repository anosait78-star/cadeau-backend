import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  decodeCursor,
  InvalidCursorError,
  Prisma,
  setTenantContext,
  type CursorValues,
  type KeysetPage,
  type PrismaClient,
} from "@cadeau/database";
import type {
  MessageThreadView,
  MessageView,
  Participant,
  SenderKind,
  ThreadStatus,
} from "../domain/message.entity";
import type {
  CreateMessageInput,
  CreateThreadInput,
  ListQuery,
  MessagingRepositoryPort,
  VendorWarehouseView,
  WriteActor,
} from "../domain/messaging-repository.port";
import { ThreadAlreadyExistsError } from "../domain/messaging.errors";
import { MESSAGING_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

/**
 * A cursor's two halves: `p` is the ordering value and `t` the tiebreak id.
 * For the thread list `p` is `lastMessageAt`, and the empty string stands for
 * a thread that has no messages yet — those sort last, after every dated one.
 */
interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

const THREAD_SELECT = {
  id: true,
  warehouseId: true,
  vendorMemberId: true,
  status: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  createdAt: true,
  warehouse: { select: { name: true } },
} as const;

type ThreadRow = Prisma.MessageThreadGetPayload<{ select: typeof THREAD_SELECT }>;

const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  senderProfileId: true,
  senderKind: true,
  body: true,
  deletedAt: true,
  createdAt: true,
  sender: { select: { fullName: true } },
} as const;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

/**
 * Prisma-backed messaging repository (EPIC-17).
 *
 * Every method runs inside a tenant transaction, so the `message_threads` RLS
 * policy applies to it: a vendor's query is narrowed to their own warehouse by
 * the database even when this code does not say so. The service's own checks
 * sit on top of that, to turn "no rows" into an honest 404.
 *
 * `warehouses`, `company_members` and `profiles` are read directly here rather
 * than through their owning modules — the same sibling-table idiom
 * `ReviewsRepository` uses for `orders`.
 */
@Injectable()
export class MessagingRepository implements MessagingRepositoryPort {
  constructor(@Inject(MESSAGING_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findParticipant(companyId: string, userId: string): Promise<Participant | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.companyMember.findFirst({
        where: { companyId, userId, status: "active" },
        select: { id: true, warehouseId: true },
      }),
    );
    return row === null ? null : { memberId: row.id, warehouseId: row.warehouseId };
  }

  async listVendorWarehouses(companyId: string): Promise<readonly VendorWarehouseView[]> {
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.companyMember.findMany({
        // A vendor membership is exactly one with a warehouse scope; the role
        // string is not the source of truth (see `participation.ts`).
        where: { companyId, status: "active", warehouseId: { not: null } },
        select: {
          id: true,
          warehouseId: true,
          warehouse: { select: { name: true } },
          messageThread: { select: { id: true } },
        },
        orderBy: { warehouse: { name: "asc" } },
      }),
    );

    return rows.flatMap((row): VendorWarehouseView[] => {
      // Narrowing only: the `warehouseId: { not: null }` filter above already
      // guarantees both, but Prisma types them as nullable.
      if (row.warehouseId === null || row.warehouse === null) return [];
      return [
        {
          warehouseId: row.warehouseId,
          warehouseName: row.warehouse.name,
          vendorMemberId: row.id,
          threadId: row.messageThread?.id ?? null,
        },
      ];
    });
  }

  async listThreads(
    companyId: string,
    viewerProfileId: string,
    query: ListQuery,
  ): Promise<KeysetPage<MessageThreadView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query.cursor);

    const where: Prisma.MessageThreadWhereInput = { companyId };
    if (cursor !== null) {
      where.AND = [{ OR: this.afterCursor(cursor) }];
    }

    const { rows, unread } = await this.tenantTx(companyId, async (tx) => {
      const found = await tx.messageThread.findMany({
        where,
        // Nulls last: a thread nobody has written in yet belongs at the bottom
        // of the list, not above every active conversation.
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        take: limit + 1,
        select: THREAD_SELECT,
      });
      return { rows: found, unread: await this.unreadCounts(tx, viewerProfileId, found) };
    });

    const views = rows.map((row) => this.toThreadView(row, unread.get(row.id) ?? 0));
    return buildKeysetPage(
      views,
      limit,
      (view): CursorValues => ({ p: view.lastMessageAt ?? "", t: view.id }),
    );
  }

  async findThreadById(
    companyId: string,
    viewerProfileId: string,
    threadId: string,
  ): Promise<MessageThreadView | null> {
    return this.findOneThread(companyId, viewerProfileId, { id: threadId, companyId });
  }

  async findThreadByWarehouse(
    companyId: string,
    viewerProfileId: string,
    warehouseId: string,
  ): Promise<MessageThreadView | null> {
    return this.findOneThread(companyId, viewerProfileId, { warehouseId, companyId });
  }

  async createThread(actor: WriteActor, input: CreateThreadInput): Promise<MessageThreadView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      try {
        const row = await tx.messageThread.create({
          data: {
            companyId: actor.companyId,
            warehouseId: input.warehouseId,
            vendorMemberId: input.vendorMemberId,
            createdBy: actor.actorId,
            updatedBy: actor.actorId,
          } satisfies Prisma.MessageThreadUncheckedCreateInput,
          select: THREAD_SELECT,
        });
        // A brand-new thread has no messages, so nothing can be unread in it.
        return this.toThreadView(row, 0);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ThreadAlreadyExistsError(input.warehouseId);
        }
        throw error;
      }
    });
  }

  async listMessages(
    companyId: string,
    threadId: string,
    query: ListQuery,
  ): Promise<KeysetPage<MessageView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query.cursor);

    const where: Prisma.MessageWhereInput = { companyId, threadId };
    if (cursor !== null) {
      where.AND = [
        {
          OR: [
            { createdAt: { lt: new Date(cursor.p) } },
            { AND: [{ createdAt: new Date(cursor.p) }, { id: { lt: cursor.t } }] },
          ],
        },
      ];
    }

    const rows = await this.tenantTx(companyId, (tx) =>
      tx.message.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: MESSAGE_SELECT,
      }),
    );

    const views = rows.map((row) => this.toMessageView(row));
    return buildKeysetPage(
      views,
      limit,
      (view): CursorValues => ({ p: view.createdAt, t: view.id }),
    );
  }

  async createMessage(actor: WriteActor, input: CreateMessageInput): Promise<MessageView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const row = await tx.message.create({
        data: {
          companyId: actor.companyId,
          threadId: input.threadId,
          senderProfileId: actor.actorId,
          senderKind: input.senderKind,
          body: input.body,
        } satisfies Prisma.MessageUncheckedCreateInput,
        select: MESSAGE_SELECT,
      });

      // Same transaction as the insert: the thread list reads these two
      // columns instead of the newest message, so they must never lag behind
      // a message that is already visible.
      await tx.messageThread.update({
        where: { id: input.threadId },
        data: {
          lastMessageAt: row.createdAt,
          lastMessagePreview: input.preview,
          updatedBy: actor.actorId,
        },
      });

      return this.toMessageView(row);
    });
  }

  async markRead(actor: WriteActor, threadId: string): Promise<{ lastReadAt: string }> {
    const now = new Date();
    const row = await this.tenantTx(actor.companyId, (tx) =>
      tx.messageRead.upsert({
        where: { threadId_profileId: { threadId, profileId: actor.actorId } },
        create: { companyId: actor.companyId, threadId, profileId: actor.actorId, lastReadAt: now },
        update: { lastReadAt: now },
        select: { lastReadAt: true },
      }),
    );
    return { lastReadAt: row.lastReadAt.toISOString() };
  }

  // ---- internals -------------------------------------------------------------

  private async findOneThread(
    companyId: string,
    viewerProfileId: string,
    where: Prisma.MessageThreadWhereInput,
  ): Promise<MessageThreadView | null> {
    const result = await this.tenantTx(companyId, async (tx) => {
      const row = await tx.messageThread.findFirst({ where, select: THREAD_SELECT });
      if (row === null) return null;
      const unread = await this.unreadCounts(tx, viewerProfileId, [row]);
      return { row, unread: unread.get(row.id) ?? 0 };
    });
    return result === null ? null : this.toThreadView(result.row, result.unread);
  }

  /**
   * How many messages in each thread the viewer has not seen — their own
   * number, never a shared one.
   *
   * Two queries for the whole page rather than two per thread: the read
   * cursors come back in one `findMany`, and the counts in one `groupBy` whose
   * `OR` carries each thread's own cutoff. A thread with no cursor row has
   * never been opened, so every message from the other side counts.
   */
  private async unreadCounts(
    tx: Tx,
    viewerProfileId: string,
    threads: readonly { id: string }[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (threads.length === 0) return counts;

    const threadIds = threads.map((t) => t.id);
    const reads = await tx.messageRead.findMany({
      where: { threadId: { in: threadIds }, profileId: viewerProfileId },
      select: { threadId: true, lastReadAt: true },
    });
    const readAt = new Map(reads.map((r) => [r.threadId, r.lastReadAt]));

    const grouped = await tx.message.groupBy({
      by: ["threadId"],
      where: {
        // Your own messages are never unread to you, and a deleted one has
        // nothing left to read.
        senderProfileId: { not: viewerProfileId },
        deletedAt: null,
        OR: threadIds.map((threadId) => {
          const cutoff = readAt.get(threadId);
          return cutoff === undefined ? { threadId } : { threadId, createdAt: { gt: cutoff } };
        }),
      },
      _count: { _all: true },
    });

    for (const group of grouped) {
      counts.set(group.threadId, group._count._all);
    }
    return counts;
  }

  /**
   * The keyset predicate for "strictly after this cursor" under
   * `lastMessageAt DESC NULLS LAST, id DESC`.
   *
   * The null half is what makes this more than the usual two-clause cursor: an
   * undated thread sorts below every dated one, so a cursor on a dated row must
   * also admit the undated tail, and a cursor already in that tail must stay
   * inside it.
   */
  private afterCursor(cursor: DecodedCursor): Prisma.MessageThreadWhereInput[] {
    if (cursor.p === "") {
      return [{ lastMessageAt: null, id: { lt: cursor.t } }];
    }
    const at = new Date(cursor.p);
    return [
      { lastMessageAt: { lt: at } },
      { lastMessageAt: at, id: { lt: cursor.t } },
      { lastMessageAt: null },
    ];
  }

  private decode(raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    const decoded = decodeCursor(raw);
    const p = decoded["p"];
    const t = decoded["t"];
    if (typeof p !== "string" || typeof t !== "string") {
      throw new InvalidCursorError();
    }
    // "" is the legitimate encoding of "this thread has no messages yet";
    // anything else must parse as a date.
    if (p !== "" && Number.isNaN(Date.parse(p))) {
      throw new InvalidCursorError();
    }
    return { p, t };
  }

  private toThreadView(row: ThreadRow, unreadCount: number): MessageThreadView {
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      vendorMemberId: row.vendorMemberId,
      status: row.status as ThreadStatus,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: row.lastMessagePreview,
      unreadCount,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMessageView(row: MessageRow): MessageView {
    return {
      id: row.id,
      threadId: row.threadId,
      senderProfileId: row.senderProfileId,
      senderName: row.sender.fullName,
      senderKind: row.senderKind as SenderKind,
      // A deleted message keeps its row for the audit trail, but its text is
      // not part of the conversation any more.
      body: row.deletedAt === null ? row.body : null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }
}
