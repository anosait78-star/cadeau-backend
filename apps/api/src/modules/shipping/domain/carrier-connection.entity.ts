/**
 * Carrier-connection domain views. `apiKeyEncrypted` never appears here — the
 * decrypted key exists only for the instant a carrier adapter needs it
 * (loaded directly from the repository row, never carried in a view type
 * that could be logged or serialized to a response).
 */

/** A tenant's connection to a real carrier, as read (never carries the key). */
export interface CarrierConnectionView {
  /** The connection row's id (audit-log entityId); `null` when there is no row (e.g. `manual`, or not yet connected). */
  readonly id: string | null;
  readonly carrier: string;
  readonly connected: boolean;
  /** True when the connect-time probe found no pickup location configured yet. */
  readonly pickupLocationWarning: boolean;
  readonly connectedAt: string | null;
}
