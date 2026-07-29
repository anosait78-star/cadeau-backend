import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** An accessible, theme-aware loading spinner (uses currentColor). */
export function Spinner({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}): ReactNode {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-5 w-5 animate-spin text-primary", className)}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
