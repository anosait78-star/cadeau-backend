import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

export interface TableToolbarSearch {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder: string;
  readonly label: string;
}

export interface TableToolbarProps {
  readonly search?: TableToolbarSearch;
  readonly primaryActions?: ReactNode;
  readonly secondaryActions?: ReactNode;
  readonly className?: string;
}

/**
 * Generic list-page toolbar: a search slot plus two action slots. Carries no
 * business logic — every action (Export, Print, Tags, Advanced Filters, New)
 * is composed in by the consuming page.
 */
export function TableToolbar({
  search,
  primaryActions,
  secondaryActions,
  className,
}: TableToolbarProps): ReactNode {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {search !== undefined ? (
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <Label htmlFor="table-toolbar-search">{search.label}</Label>
          <Input
            id="table-toolbar-search"
            value={search.value}
            placeholder={search.placeholder}
            onChange={(e) => search.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search.onSubmit();
            }}
          />
        </div>
      ) : null}
      {secondaryActions !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">{secondaryActions}</div>
      ) : null}
      {primaryActions !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">{primaryActions}</div>
      ) : null}
    </div>
  );
}
