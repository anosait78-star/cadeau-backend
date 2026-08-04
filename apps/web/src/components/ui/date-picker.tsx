import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/** `YYYY-MM-DD` — the same shape `input[type=date]` produces, so this drops in as a replacement. */
type IsoDate = string;

function toIso(date: Date): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Custom Date Picker: Radix Popover + calendar grid (roadmap §4.1/§5),
 * replacing native `input[type=date]`. Value/onChange use the same
 * `YYYY-MM-DD` shape as the native input for a drop-in swap. The grid itself
 * stays `dir="ltr"` regardless of app locale — matching the rest of the
 * system's convention of forcing LTR for numeric/date content inside RTL.
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  min,
  max,
  className,
  id,
}: {
  value: IsoDate | null;
  onChange: (value: IsoDate | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  min?: IsoDate;
  max?: IsoDate;
  className?: string;
  id?: string;
}): ReactNode {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = value ? fromIso(value) : null;
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected ?? new Date()));

  const minDate = min ? fromIso(min) : null;
  const maxDate = max ? fromIso(max) : null;

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "narrow" }),
    [locale],
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }),
    [locale],
  );

  const weekdays = useMemo(
    // 2023-01-01 is a Sunday — used only as a reference week to read localized weekday labels.
    () => Array.from({ length: 7 }, (_, i) => weekdayFormatter.format(new Date(2023, 0, 1 + i))),
    [weekdayFormatter],
  );

  const cells = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const leading = first.getDay();
    const total = daysInMonth(viewMonth);
    const days: Array<Date | null> = [];
    for (let i = 0; i < leading; i += 1) days.push(null);
    for (let d = 1; d <= total; d += 1)
      days.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    return days;
  }, [viewMonth]);

  const isDisabled = (date: Date): boolean => {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          dir="ltr"
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-start text-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span>
            {selected
              ? dateFormatter.format(selected)
              : (placeholder ?? t("datePicker.placeholder"))}
          </span>
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-none p-3" dir="ltr">
        <div className="flex items-center justify-between pb-2">
          <button
            type="button"
            className="rounded-md p-1 hover:bg-muted"
            aria-label="Previous month"
            onClick={() =>
              setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
            }
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="text-sm font-medium">{monthFormatter.format(viewMonth)}</span>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-muted"
            aria-label="Next month"
            onClick={() =>
              setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
            }
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 pb-1 text-center text-xs text-muted-foreground">
          {weekdays.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) =>
            date === null ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                type="button"
                disabled={isDisabled(date)}
                onClick={() => {
                  onChange(toIso(date));
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md text-sm hover:bg-muted",
                  "disabled:pointer-events-none disabled:opacity-40",
                  selected &&
                    isSameDay(date, selected) &&
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {date.getDate()}
              </button>
            ),
          )}
        </div>
        {value ? (
          <button
            type="button"
            className="mt-2 w-full rounded-md py-1 text-center text-xs text-muted-foreground hover:bg-muted"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            {t("datePicker.clear")}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
