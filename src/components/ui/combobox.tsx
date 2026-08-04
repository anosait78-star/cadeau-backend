import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * Searchable single-select, built on the same Radix Popover + cmdk primitives
 * as the command palette (see globals.css [cmdk-*] styling). Replaces native
 * `<select>` wherever the option list is long enough to need search (roadmap
 * §4.1/§5 — governorate, carrier, etc).
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  ariaLabel,
  disabled,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected?.label ?? placeholder ?? t("combobox.placeholder")}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-w-none w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command className="flex flex-col">
          <Command.Input
            placeholder={searchPlaceholder ?? t("combobox.search")}
            className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-60 overflow-auto p-1">
            <Command.Empty className="px-2 py-4 text-center text-sm text-muted-foreground">
              {emptyText ?? t("combobox.empty")}
            </Command.Empty>
            {options.map((option) => (
              <Command.Item
                key={option.value}
                value={option.label}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn("h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")}
                  aria-hidden="true"
                />
                <span>{option.label}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
