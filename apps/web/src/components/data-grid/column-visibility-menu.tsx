import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Column, DataGridColumnVisibility } from "./types";

export function ColumnVisibilityMenu<T>({
  columns,
  columnVisibility,
  label,
  triggerLabel,
}: {
  columns: Column<T>[];
  columnVisibility: DataGridColumnVisibility;
  label: string;
  triggerLabel: string;
}): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={columnVisibility.visible.has(column.key)}
            onCheckedChange={() => columnVisibility.onToggle(column.key)}
            onSelect={(event) => event.preventDefault()}
          >
            {column.header}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
