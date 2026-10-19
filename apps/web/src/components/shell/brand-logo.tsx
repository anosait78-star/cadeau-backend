import type { ReactNode } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/**
 * The Cadeau brand mark. Two cuts of the same artwork: `mark` is the bow on its
 * own, for the places that already spell the name next to it (the sidebar
 * header); `lockup` is mark + wordmark, for the places that carry the brand
 * alone. Both PNGs are transparent, so they sit on either theme unchanged.
 */
export function BrandLogo({
  variant = "mark",
  className,
}: {
  variant?: "mark" | "lockup";
  className?: string;
}): ReactNode {
  const { t } = useI18n();

  return (
    <img
      src={variant === "mark" ? "/logo-mark.png" : "/logo.png"}
      alt={t("app.name")}
      className={cn("object-contain", className)}
      draggable={false}
    />
  );
}
