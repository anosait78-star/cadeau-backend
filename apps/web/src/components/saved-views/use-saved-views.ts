import { useCallback, useEffect, useState } from "react";

export interface SavedView<TFilters> {
  readonly id: string;
  readonly name: string;
  readonly filters: TFilters;
  readonly createdAt?: string;
}

function storageKey(namespace: string, userId: string | null): string {
  return `cadeau.${namespace}.${userId ?? "anon"}`;
}

function readCustomViews<TFilters>(
  namespace: string,
  userId: string | null,
): SavedView<TFilters>[] {
  try {
    const raw = window.localStorage.getItem(storageKey(namespace, userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView<TFilters>[]) : [];
  } catch {
    return [];
  }
}

function writeCustomViews<TFilters>(
  namespace: string,
  userId: string | null,
  views: SavedView<TFilters>[],
): void {
  try {
    window.localStorage.setItem(storageKey(namespace, userId), JSON.stringify(views));
  } catch {
    /* best-effort persistence only */
  }
}

/**
 * Custom user-created saved views, persisted in localStorage per-user, keyed
 * by `namespace` so each module gets its own storage bucket (e.g. "orders",
 * "products"). Built-in presets are page-specific and supplied by the caller
 * — this hook only manages the custom, user-created ones.
 */
export function useSavedViews<TFilters>(
  namespace: string,
  userId: string | null,
): {
  readonly customViews: SavedView<TFilters>[];
  readonly save: (name: string, filters: TFilters) => void;
  readonly remove: (id: string) => void;
} {
  const [customViews, setCustomViews] = useState<SavedView<TFilters>[]>(() =>
    readCustomViews<TFilters>(namespace, userId),
  );

  useEffect(() => {
    setCustomViews(readCustomViews<TFilters>(namespace, userId));
  }, [namespace, userId]);

  const save = useCallback(
    (name: string, filters: TFilters): void => {
      setCustomViews((prev) => {
        const next = [
          ...prev,
          { id: crypto.randomUUID(), name, filters, createdAt: new Date().toISOString() },
        ];
        writeCustomViews(namespace, userId, next);
        return next;
      });
    },
    [namespace, userId],
  );

  const remove = useCallback(
    (id: string): void => {
      setCustomViews((prev) => {
        const next = prev.filter((v) => v.id !== id);
        writeCustomViews(namespace, userId, next);
        return next;
      });
    },
    [namespace, userId],
  );

  return { customViews, save, remove };
}
