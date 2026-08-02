import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

/** Native checkbox styled from design tokens; pair with a `<Label htmlFor>`. */
export function Checkbox({
  className,
  type: _type,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }): ReactNode {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 rounded border border-input bg-background text-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
