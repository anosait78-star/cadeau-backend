import { Package } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const SIZE_CLASS = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
} as const;

/**
 * A product's display image, or a placeholder (Vendor Accounts, Phase 7) —
 * reused anywhere a product/order-item row needs a thumbnail (currently the
 * vendor dashboard/orders/order-detail screens). Mirrors the existing image
 * treatment in `products-columns.tsx` (bordered, rounded, `object-cover`)
 * rather than inventing a new visual language, and never breaks the row's
 * layout: a missing `imageUrl`, or one that fails to load, always renders the
 * same fixed-size placeholder box instead of collapsing to nothing.
 */
export function ProductThumb({
  imageUrl,
  alt = "",
  size = "md",
  className,
}: {
  readonly imageUrl: string | null;
  readonly alt?: string;
  readonly size?: "sm" | "md";
  readonly className?: string;
}): ReactNode {
  const [broken, setBroken] = useState(false);
  const sizeClass = SIZE_CLASS[size];

  if (imageUrl === null || broken) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground",
          sizeClass,
          className,
        )}
        aria-hidden="true"
        data-testid="product-thumb-placeholder"
      >
        <Package className="h-1/2 w-1/2" aria-hidden="true" />
      </span>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={cn("shrink-0 rounded-md border border-border object-cover", sizeClass, className)}
      data-testid="product-thumb-image"
      onError={() => setBroken(true)}
    />
  );
}
