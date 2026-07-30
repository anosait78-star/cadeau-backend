import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Text input styled from design tokens; logical padding mirrors correctly in RTL. */
export function Input({
  className,
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <input
      type={type ?? "text"}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}
