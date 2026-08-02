import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>): ReactNode {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-64 rounded-md border border-border bg-card p-2 text-sm text-card-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
