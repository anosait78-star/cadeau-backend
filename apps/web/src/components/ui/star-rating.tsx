import { Star } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const VALUES = [1, 2, 3, 4, 5] as const;

/** A 1-5 star picker: click a star to set the rating. */
export function StarRatingInput({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={ariaLabel}>
      {VALUES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={String(n)}
          disabled={disabled}
          onClick={() => onChange(n)}
          className="rounded p-0.5 disabled:pointer-events-none disabled:opacity-50"
        >
          <Star
            className={cn(
              "h-5 w-5",
              n <= value ? "fill-warning text-warning" : "fill-none text-muted-foreground",
            )}
          />
        </button>
      ))}
    </div>
  );
}

/** A read-only 1-5 (or fractional average) star display. */
export function StarRatingDisplay({
  value,
  size = "sm",
}: {
  value: number;
  size?: "sm" | "md";
}): ReactNode {
  const dims = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  return (
    <div className="flex items-center gap-1" aria-label={String(value)}>
      {VALUES.map((n) => (
        <Star
          key={n}
          className={cn(
            dims,
            n <= Math.round(value)
              ? "fill-warning text-warning"
              : "fill-none text-muted-foreground",
          )}
        />
      ))}
      <span className="text-caption text-muted-foreground">{value.toFixed(1)}</span>
    </div>
  );
}
