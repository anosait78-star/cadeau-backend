import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Form label. Pair with an input via `htmlFor`/`id` for an accessible name. */
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>): ReactNode {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}
