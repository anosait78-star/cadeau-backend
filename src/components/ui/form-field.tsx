import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/**
 * Label + input slot + a reserved helper/error row (roadmap §4.1 "Redesign
 * principles for all ten forms" — required/optional convention, and
 * validation text that reserves layout space instead of shifting the form
 * when it appears). The helper row always renders, even empty, so the field
 * below it never jumps.
 */
export function FormField({
  label,
  htmlFor,
  required,
  optional,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
        {optional ? <span className="text-muted-foreground"> ({t("form.optional")})</span> : null}
      </Label>
      {children}
      <p
        className={cn("min-h-4 text-caption", error ? "text-destructive" : "text-muted-foreground")}
      >
        {error ?? hint ?? ""}
      </p>
    </div>
  );
}
