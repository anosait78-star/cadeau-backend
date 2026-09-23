import { Inject, Injectable, Logger } from "@nestjs/common";
import type { FileStoragePort } from "@cadeau/storage";
import { FILE_STORAGE } from "../domain/file-storage.token";
import {
  MESSAGING_REPOSITORY,
  type MessagingRepositoryPort,
} from "../domain/messaging-repository.port";

/** How long an unsent upload is kept before it is swept. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** Most attachments removed in one pass, so a sweep stays bounded. */
export const ORPHAN_BATCH_SIZE = 100;

/**
 * Deletes uploads that were never sent (EPIC-17 · M17.3).
 *
 * Someone who picks an image and then closes the composer leaves an object in
 * the bucket and a row pointing at it, attached to no message. Without a sweep
 * those accumulate forever — paid for, and holding a picture the sender
 * decided not to send.
 *
 * The object goes first, then the row: if the process dies between the two,
 * the row survives and the next pass retries it. The other order would drop
 * the only record of the object's key and leak the bytes permanently.
 *
 * Nothing schedules this yet — it is invoked by the deployment's job runner.
 * The grace period is generous because the clock starts at *upload*, not at
 * send, and a slow composer must never have its images swept out from under it.
 */
@Injectable()
export class OrphanAttachmentSweeper {
  private readonly logger = new Logger(OrphanAttachmentSweeper.name);

  constructor(
    @Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepositoryPort,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /** Runs one bounded pass. Returns how many attachments were removed. */
  async sweep(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ORPHAN_GRACE_MS);
    const orphans = await this.repo.findOrphanedAttachments(cutoff, ORPHAN_BATCH_SIZE);
    if (orphans.length === 0) return 0;

    const deletable: string[] = [];
    for (const orphan of orphans) {
      try {
        await this.storage.delete(orphan.storageKey);
        deletable.push(orphan.id);
      } catch (error) {
        // One unreachable object must not strand the rest of the batch; the
        // row stays, so the next pass tries again.
        this.logger.warn(
          `Could not delete orphaned object ${orphan.storageKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const removed = await this.repo.deleteAttachments(deletable);
    if (removed > 0) this.logger.log(`Swept ${removed} unsent attachment(s).`);
    return removed;
  }
}
