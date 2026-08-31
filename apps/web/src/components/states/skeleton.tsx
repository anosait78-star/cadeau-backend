import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A placeholder block for content that has not arrived. Skeletons exist to hold
 * the *shape* of the eventual content, so nothing jumps when data lands — a
 * spinner in the same place says "wait" but reserves no space, and the layout
 * shifts the moment it is replaced.
 */
export function Skeleton({ className }: { className?: string }): ReactNode {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
      aria-hidden="true"
    />
  );
}

/**
 * The loading shape of a mobile card list: a run of cards matching the real
 * row's height and internal rhythm (a title line, then a two-column block of
 * label/value pairs). Announced once as a busy status rather than as a dozen
 * meaningless boxes.
 */
export function CardListSkeleton({ rows = 5, label }: { rows?: number; label: string }): ReactNode {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}
