import { useCallback, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  advanceVendorGroupStatus,
  forwardVendorStatuses,
  type VendorGroup,
  type VendorGroupStatus,
} from "./vendor-api";

/** The drag payload's MIME type — namespaced so nothing else claims the drop. */
const DRAG_TYPE = "application/x-cadeau-vendor-group";

/** What a draggable order card/row spreads onto its element. */
export interface VendorDragProps {
  readonly draggable: true;
  readonly onDragStart: (event: DragEvent) => void;
  readonly onDragEnd: () => void;
}

/** What a status tab needs to render itself as a drop target. */
export interface StatusDropTarget {
  /** True while a drag is in flight and this status is a legal destination. */
  readonly droppable: boolean;
  /** True while the pointer is over this specific target. */
  readonly active: boolean;
  readonly handlers: {
    readonly onDragOver: (event: DragEvent) => void;
    readonly onDragEnter: (event: DragEvent) => void;
    readonly onDragLeave: (event: DragEvent) => void;
    readonly onDrop: (event: DragEvent) => void;
  };
}

/**
 * Drag a vendor order onto a status to move it there — the pointer equivalent
 * of the panel's status buttons, built on the browser's own HTML5 drag and
 * drop (no dependency, and it is the only drag API that works identically in
 * LTR and RTL without hand-computing coordinates).
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
  const [dragging, setDragging] = useState<VendorGroup | null>(null);
  const [overStatus, setOverStatus] = useState<VendorGroupStatus | null>(null);
  // The dragged group is mirrored in a ref because `drop` must not depend on
  // React having committed the `dragstart` state update first: state drives
  // what the tabs look like, the ref decides what actually moves.
  const draggingRef = useRef<VendorGroup | null>(null);
  // `dragleave` fires when the pointer crosses into a child element too, so a
  // depth counter is what keeps the highlight from flickering over the label.
  const enterDepth = useRef(0);

  /** Whether `group` may legally be dropped on `status` (forward only). */
  const canDrop = (group: VendorGroup, status: VendorGroupStatus): boolean =>
    forwardVendorStatuses(group.status).includes(status);

  const allowed = dragging === null ? [] : forwardVendorStatuses(dragging.status);

  const reset = useCallback((): void => {
    draggingRef.current = null;
    setDragging(null);
    setOverStatus(null);
    enterDepth.current = 0;
  }, []);

  const dragProps = (group: VendorGroup): VendorDragProps => ({
    draggable: true,
    onDragStart: (event: DragEvent): void => {
      // Some payload must be set or Firefox refuses to start the drag at all.
      event.dataTransfer.setData(DRAG_TYPE, group.id);
      event.dataTransfer.effectAllowed = "move";
      draggingRef.current = group;
      setDragging(group);
      onDragStart?.();
    },
    onDragEnd: reset,
  });

  const move = (group: VendorGroup, to: VendorGroupStatus): void => {
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
  };

  const dropTarget = (status: VendorGroupStatus): StatusDropTarget => {
    const droppable = allowed.includes(status);
    return {
      droppable,
      active: droppable && overStatus === status,
      handlers: {
        onDragOver: (event: DragEvent): void => {
          if (!droppable) return;
          // Without preventDefault the browser treats this as "not a drop
          // zone" and never fires `drop`.
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        },
        onDragEnter: (event: DragEvent): void => {
          if (!droppable) return;
          event.preventDefault();
          enterDepth.current += 1;
          setOverStatus(status);
        },
        onDragLeave: (): void => {
          if (!droppable) return;
          enterDepth.current -= 1;
          if (enterDepth.current <= 0) {
            enterDepth.current = 0;
            setOverStatus(null);
          }
        },
        onDrop: (event: DragEvent): void => {
          const group = draggingRef.current;
          if (group === null || !canDrop(group, status)) return;
          event.preventDefault();
          reset();
          move(group, status);
        },
      },
    };
  };

  return { draggingId: dragging?.id ?? null, dragProps, dropTarget };
}
