import {
  useStatusDrag,
  type StatusDragProps,
  type StatusDropTarget,
} from "@/hooks/use-status-drag";
import {
  advanceVendorGroupStatus,
  forwardVendorStatuses,
  type VendorGroup,
  type VendorGroupStatus,
} from "./vendor-api";

/** The drag payload's MIME type — namespaced so nothing else claims the drop. */
const DRAG_TYPE = "application/x-cadeau-vendor-group";

/**
 * What a draggable order card/row spreads onto its element.
 *
 * @deprecated Prefer {@link StatusDragProps}; kept as an alias so the vendor
 * board's existing imports keep working.
 */
export type VendorDragProps = StatusDragProps;

export type { StatusDropTarget };

/**
 * Drag a vendor order onto a status to move it there — the pointer equivalent
 * of the panel's status buttons.
 *
 * The drag mechanics live in {@link useStatusDrag} (shared with the company
 * orders board since 2026-09-13); what remains here is the vendor-specific
 * half: which drops are legal, and what a drop does.
 *
 * The legal drops are exactly {@link forwardVendorStatuses}: forward, any
 * distance, so an order that was packed and handed over in one go can go
 * straight from "new" to "delivered". Every other status stays inert rather
 * than accepting the drop and then showing an error the server sent back.
 *
 * The move is applied optimistically through `patchGroup` and rolled back to
 * the exact group the caller started from if the request fails — the vendor's
 * own list is small and already fully loaded, so a refetch to recover would
 * be a visible flash for no gain.
 *
 * This is a pointer-only affordance by nature. It is deliberately additive:
 * the same transitions are always available from the order panel's buttons,
 * which is what keyboard and screen-reader users act through.
 */
export function useVendorStatusDrag({
  patchGroup,
  onDragStart,
  onMoved,
  onFailed,
}: {
  readonly patchGroup: (group: VendorGroup) => void;
  /** Called when a drag begins — the page uses it to close the open panel. */
  readonly onDragStart?: () => void;
  readonly onMoved?: (group: VendorGroup, to: VendorGroupStatus) => void;
  readonly onFailed?: () => void;
}): {
  readonly draggingId: string | null;
  readonly dragProps: (group: VendorGroup) => VendorDragProps;
  readonly dropTarget: (status: VendorGroupStatus) => StatusDropTarget;
} {
  return useStatusDrag<VendorGroup, VendorGroupStatus>({
    dragType: DRAG_TYPE,
    canDrop: (group, status) => forwardVendorStatuses(group.status).includes(status),
    ...(onDragStart !== undefined ? { onDragStart } : {}),
    onMove: (group, to): void => {
      const before = group;
      patchGroup({ ...group, status: to });
      void advanceVendorGroupStatus(group.id, to)
        .then((updated) => {
          patchGroup(updated);
          onMoved?.(updated, to);
        })
        .catch(() => {
          patchGroup(before);
          onFailed?.();
        });
    },
  });
}
