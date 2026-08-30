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

/**
 * A read-only 1-5 (or fractional average) star display.
 *
 * A rating is typed as a plain `number`, but this renders inside detail panels
 * fed straight from the API — one malformed or half-loaded record must not
 * take the whole panel down with it. Anything that isn't a finite number
 * degrades to an empty, dashed rating instead of throwing.
 */
export function StarRatingDisplay({
  value,
  size = "sm",
}: {
  value: number;
  size?: "sm" | "md";
}): ReactNode {
  const dims = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  const rating = Number.isFinite(value) ? Math.min(5, Math.max(0, value)) : null;
  const filled = rating === null ? 0 : Math.round(rating);
  const label = rating === null ? "—" : rating.toFixed(1);

  return (
    <div className="flex items-center gap-1" aria-label={label}>
      {VALUES.map((n) => (
        <Star
          key={n}
          className={cn(
            dims,
            n <= filled ? "fill-warning text-warning" : "fill-none text-muted-foreground",
          )}
        />
      ))}
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}
