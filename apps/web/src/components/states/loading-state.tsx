import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/** Standard loading state: a centered spinner with a localized label. */
export function LoadingState({
  label,
  className,
}: {
  label?: string;
  className?: string;
}): ReactNode {
  const { t } = useI18n();
  const text = label ?? t("states.loading");
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-10 text-muted-foreground",
        className,
      )}
    >
      {/* The Spinner carries role="status" + aria-label, so it is the single
          announced status region; the text below is a visual duplicate. */}
      <Spinner label={text} />
      <p className="text-sm">{text}</p>
    </div>
  );
}
