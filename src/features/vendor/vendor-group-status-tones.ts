import type { BadgeTone } from "@/components/status-badge/status-badge";
import type { VendorGroupStatus } from "./vendor-api";

/**
 * Vendor group status → tone map (Vendor Accounts, Phase 3/4), shared between
 * the company-side "تتبع الطلب" tab and the vendor's own dashboard so the
 * same status always reads the same color everywhere. Mirrors the shape of
 * {@link ../../pages/orders/orders-status-tones}.
 */
export const VENDOR_GROUP_STATUS_TONE: Readonly<Record<VendorGroupStatus, BadgeTone>> = {
  new: "neutral",
  processing: "warning",
  ready: "info",
  delivered: "success",
};
