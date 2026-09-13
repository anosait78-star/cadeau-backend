import { useCallback, useRef, useState } from "react";
import type { DragEvent } from "react";

/** What a draggable card/row spreads onto its element. */
export interface StatusDragProps {
  readonly draggable: true;
  readonly onDragStart: (event: DragEvent) => void;
  readonly onDragEnd: () => void;
}

/** What a status column/tab needs to render itself as a drop target. */
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
 * Drag an item onto a status to move it there, built on the browser's own
 * HTML5 drag and drop — no dependency, and it is the only drag API that works
 * identically in LTR and RTL without hand-computing coordinates.
 *
 * This hook owns the drag *mechanics* only. What counts as a legal drop
 * (`canDrop`) and what actually happens on one (`onMove` — the request, the
 * optimistic patch, the rollback) belong to the caller, because they differ
 * per board: the vendor board advances forward-only through four statuses and
 * fires immediately, while the company board follows the full twelve-state
 * transition graph and has to divert a drop onto `cancelled` into a modal
 * that collects a reason first.
 *
 * Extracted from the vendor board (2026-09-13) when the company orders board
 * needed the same behaviour. It is deliberately shared rather than copied:
 * the awkward parts below were each bought with a real browser bug, and two
 * copies would drift apart on the next one.
 *
 * Dragging is a pointer-only affordance by nature, so it must never be the
 * only route to a transition — callers are expected to keep an equivalent
 * button/menu path for keyboard and screen-reader users.
 */
export function useStatusDrag<T extends { readonly id: string }, S extends string>({
  dragType,
  canDrop,
  onMove,
  onDragStart,
}: {
  /**
   * The drag payload's MIME type. Namespace it per board so a card from one
   * board can never be dropped onto another's column.
   */
  readonly dragType: string;
  readonly canDrop: (item: T, status: S) => boolean;
  readonly onMove: (item: T, to: S) => void;
  /** Called when a drag begins — a page may use it to close an open panel. */
  readonly onDragStart?: () => void;
}): {
  readonly draggingId: string | null;
  readonly dragProps: (item: T) => StatusDragProps;
  readonly dropTarget: (status: S) => StatusDropTarget;
} {
  const [dragging, setDragging] = useState<T | null>(null);
  const [overStatus, setOverStatus] = useState<S | null>(null);
  // The dragged item is mirrored in a ref because `drop` must not depend on
  // React having committed the `dragstart` state update first: state drives
  // what the columns look like, the ref decides what actually moves.
  const draggingRef = useRef<T | null>(null);
  // `dragleave` fires when the pointer crosses into a child element too, so a
  // depth counter is what keeps the highlight from flickering over the label.
  const enterDepth = useRef(0);

  const reset = useCallback((): void => {
    draggingRef.current = null;
    setDragging(null);
    setOverStatus(null);
    enterDepth.current = 0;
  }, []);

  const dragProps = (item: T): StatusDragProps => ({
    draggable: true,
    onDragStart: (event: DragEvent): void => {
      // Some payload must be set or Firefox refuses to start the drag at all.
      event.dataTransfer.setData(dragType, item.id);
      event.dataTransfer.effectAllowed = "move";
      draggingRef.current = item;
      setDragging(item);
      onDragStart?.();
    },
    onDragEnd: reset,
  });

  const dropTarget = (status: S): StatusDropTarget => {
    const droppable = dragging !== null && canDrop(dragging, status);
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
          // Read the ref, not `dragging` — see `draggingRef` above. `canDrop`
          // is re-checked here rather than trusted from `droppable`, which is
          // a render-time snapshot.
          const item = draggingRef.current;
          if (item === null || !canDrop(item, status)) return;
          event.preventDefault();
          reset();
          onMove(item, status);
        },
      },
    };
  };

  return { draggingId: dragging?.id ?? null, dragProps, dropTarget };
}
