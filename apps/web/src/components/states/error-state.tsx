import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/**
 * Standard error state: a title, a message, and an optional retry action. Title
 * and retry label fall back to localized defaults; `onRetry` renders the button.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-10 text-center",
        className,
      )}
    >
      <h3 className="text-base font-semibold text-foreground">
        {title ?? t("states.error.title")}
      </h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {description ?? t("states.error.description")}
      </p>
      {onRetry !== undefined ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {t("states.error.retry")}
        </Button>
      ) : null}
    </div>
  );
}
