import type { SavedView as GenericSavedView } from "@/components/saved-views/use-saved-views";
import { useSavedViews as useGenericSavedViews } from "@/components/saved-views/use-saved-views";
import type { ListOptions } from "@/features/orders/orders-api";

export type SavedView = GenericSavedView<ListOptions>;

const NAMESPACE = "ordersSavedViews";

/** The five built-in presets. "Late" maps to the existing `followUpState` equality filter. */
export function builtInViews(currentUserId: string | null): SavedView[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return [
    { id: "all", name: "orders.savedViews.all", filters: {} },
    {
      id: "mine",
      name: "orders.savedViews.mine",
      filters: currentUserId !== null ? { assigneeId: currentUserId } : {},
    },
    {
      id: "today",
      name: "orders.savedViews.today",
      filters: { createdAtFrom: startOfToday.toISOString() },
    },
    { id: "late", name: "orders.savedViews.late", filters: { followUpState: "no_answer" } },
    { id: "cancelled", name: "orders.savedViews.cancelled", filters: { status: "cancelled" } },
  ];
}

/** Custom user-created saved views, persisted in localStorage per-user. */
export function useSavedViews(userId: string | null): {
  readonly customViews: SavedView[];
  readonly save: (name: string, filters: ListOptions) => void;
  readonly remove: (id: string) => void;
} {
  return useGenericSavedViews<ListOptions>(NAMESPACE, userId);
}
