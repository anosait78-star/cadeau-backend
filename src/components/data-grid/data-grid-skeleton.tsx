import type { ReactNode } from "react";

export function DataGridSkeleton({
  columnCount,
  rowCount = 6,
}: {
  columnCount: number;
  rowCount?: number;
}): ReactNode {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={rowIndex} className="border-b border-border last:border-0" aria-hidden="true">
          {Array.from({ length: columnCount }, (_, colIndex) => (
            <td key={colIndex} className="px-3 py-2.5">
              <div className="h-4 animate-pulse rounded bg-muted" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
