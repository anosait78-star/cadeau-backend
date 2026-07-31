import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Placeholder for a missing optional value. */
export const DASH = "—";

/** Format integer minor units as a locale-formatted decimal amount (2dp), matching orders/products. */
export function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format an ISO date string for display, or a dash when absent. */
export function formatDate(iso: string | null | undefined, locale: string): string {
  return iso === null || iso === undefined ? DASH : new Date(iso).toLocaleDateString(locale);
}

/** A labeled form field wrapper, optionally spanning both grid columns. */
export function Field({
  id,
  label,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`flex flex-col gap-1${wide ? " sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** A selectable option (for a plain `<select>`). */
export interface Option {
  readonly id: string;
  readonly name: string;
}

/** A select over a set of options, with a blank ("none") entry. */
export function OptionSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  ariaLabel: string;
}): ReactNode {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="">—</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}
