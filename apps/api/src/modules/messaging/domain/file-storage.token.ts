/**
 * DI token for the object store this module writes attachments to.
 *
 * The port itself lives in `@cadeau/storage` — it is not messaging-specific —
 * so only the token belongs here, next to the module's other ports.
 */
export const FILE_STORAGE = Symbol("FILE_STORAGE");

/**
 * How long an attachment's signed URL stays valid.
 *
 * Long enough for a conversation to be scrolled and its images loaded, short
 * enough that a URL copied out of the page stops working quickly. The bucket
 * is private, so this window is the whole exposure of a leaked link.
 */
export const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;
