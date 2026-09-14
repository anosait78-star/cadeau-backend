import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

export interface ComboboxOption {
  value: string;
  label: string;
  /** A thumbnail for the row and the closed trigger — a product's picture, say. */
  imageUrl?: string | null;
  /** A second, quieter line under the label: a SKU, a variant name, a price. */
  hint?: string;
}

/**
 * An option's picture, or its first letter on a tinted tile when it has none,
 * so a list of products still lines up when only some of them carry an image.
 */
function OptionThumb({ option }: { readonly option: ComboboxOption }): ReactNode {
  const shared = "h-7 w-7 shrink-0 rounded-md";
  if (option.imageUrl === undefined || option.imageUrl === null || option.imageUrl === "") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          shared,
          "flex items-center justify-center bg-muted text-[11px] font-semibold text-muted-foreground",
        )}
      >
        {option.label.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={option.imageUrl}
      alt=""
      loading="lazy"
      className={cn(shared, "border border-border object-cover")}
    />
  );
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
  /*
   * Thumbnails are all-or-nothing for a given list: as soon as one option
   * carries a picture every row gets a tile, so the labels stay on one
   * left edge instead of stepping in and out as pictures come and go.
   */
  const withThumbs = options.some((o) => o.imageUrl !== undefined && o.imageUrl !== null);

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
          <span className="flex min-w-0 items-center gap-2">
            {selected !== undefined && withThumbs ? <OptionThumb option={selected} /> : null}
            <span className="truncate">
              {selected?.label ?? placeholder ?? t("combobox.placeholder")}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {/*
        The list starts at the trigger's width and grows past it to fit the
        longest option, capped so it never runs off a phone. Pinning it to the
        trigger's exact width instead left the list unreadable wherever the
        trigger sits in a tight row — a narrow dialog squeezed the order form's
        product picker to a few characters, and every product name wrapped down
        it one letter at a time.
      */}
      <PopoverContent
        align="start"
        className="w-auto min-w-[var(--radix-popover-trigger-width)] max-w-[min(28rem,calc(100vw-2rem))] p-0"
      >
        <Command className="flex flex-col">
          <Command.Input
            placeholder={searchPlaceholder ?? t("combobox.search")}
            className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List
            className="max-h-60 overflow-auto overscroll-contain p-1"
            // A Combobox opened from inside a Modal renders its list through a
            // separate portal (PopoverContent) outside the Modal's own DOM
            // subtree. Radix Dialog's scroll lock listens for wheel/touch at
            // the document level and, not recognizing this portaled list as
            // part of the dialog, blocks scrolling in it — stopping
            // propagation here keeps the event from ever reaching that
            // listener, so the list scrolls normally everywhere it's used.
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <Command.Empty className="px-2 py-4 text-center text-sm text-muted-foreground">
              {emptyText ?? t("combobox.empty")}
            </Command.Empty>
            {options.map((option) => (
              <Command.Item
                key={option.value}
                value={`${option.label} ${option.hint ?? ""}`}
                /*
                 * The label and the hint are two separate blocks, which a
                 * screen reader would otherwise run together into one word.
                 * Naming the row explicitly reads it the way it looks.
                 */
                aria-label={
                  option.hint !== undefined && option.hint.length > 0
                    ? `${option.label} — ${option.hint}`
                    : option.label
                }
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    option.value === value ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                {withThumbs ? <OptionThumb option={option} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.hint !== undefined && option.hint.length > 0 ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
