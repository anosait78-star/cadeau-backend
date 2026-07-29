import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Multi-column master/detail layout for the Desktop shell: a list pane beside a
 * detail pane. When no `detail` is given the list takes the full width; when a
 * detail is present the panes sit side by side with a logical (`border-s`)
 * divider, so it mirrors correctly in RTL. Domain list/detail screens compose
 * this rather than hand-rolling columns.
 */
export function ListDetailLayout({
  list,
  detail,
  className,
}: {
  list: ReactNode;
  detail?: ReactNode;
  className?: string;
}): ReactNode {
  const hasDetail = detail !== undefined;
  return (
    <div className={cn("flex h-full gap-4", className)}>
      <div className={cn("min-w-0", hasDetail ? "w-2/5 min-w-64 max-w-sm" : "flex-1")}>{list}</div>
      {hasDetail ? (
        <section className="min-w-0 flex-1 border-s border-border ps-4" aria-label="detail">
          {detail}
        </section>
      ) : null}
    </div>
  );
}
