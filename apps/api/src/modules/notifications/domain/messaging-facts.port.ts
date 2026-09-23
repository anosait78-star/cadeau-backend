/** The one fact the dispatcher needs about a thread: who its vendor is. */
export interface MessagingThreadFacts {
  /** The thread's vendor member's user id — `message.created`'s payload carries none. */
  readonly vendorUserId: string;
}

/**
 * Port for reading back the messaging facts a `message.created` event's
 * payload doesn't carry (EPIC-17 M17.5) — the event names the thread, not its
 * two sides. The thread/member rows are already committed by the time this
 * runs (`MessagingService.sendMessage` commits before publishing), so a
 * straight read is safe. Reads the `messaging` module's own tables directly,
 * the same cross-module idiom {@link ../domain/order-facts.port.ts | OrderFactsPort}
 * uses for `orders` — never an import from `modules/messaging`.
 */
export interface MessagingFactsPort {
  /** `null` if the thread no longer exists (deleted between publish and dispatch). */
  findThreadVendor(companyId: string, threadId: string): Promise<MessagingThreadFacts | null>;

  /**
   * Every active member in this company who effectively holds
   * `messaging.manage` — resolved through the same three-layer resolver the
   * guards use, so a member whose `messaging` feature is off or whose
   * permission an override revoked is not a recipient. `excludeProfileId`
   * drops the actor: nobody is told about their own message.
   */
  listMessagingManageRecipients(
    companyId: string,
    excludeProfileId: string | null,
  ): Promise<readonly string[]>;
}

/** DI token for {@link MessagingFactsPort}. */
export const MESSAGING_FACTS = Symbol("MESSAGING_FACTS");
