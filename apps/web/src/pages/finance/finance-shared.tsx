import type { ReactNode } from "react";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { formatMoney } from "@/lib/format-money";

/** Placeholder for a missing optional value. */
export const DASH = "—";

export { formatMoney };

/** Format an ISO date string for display, or a dash when absent. */
export function formatDate(iso: string | null | undefined, locale: string): string {
  return iso === null || iso === undefined ? DASH : new Date(iso).toLocaleDateString(locale);
}

/**
 * A labeled form field wrapper, optionally spanning both grid columns.
 * Thin finance-domain adapter over the shared FormField (label + reserved
 * helper/error row, roadmap §4.1) — kept as its own export so the ~30 call
 * sites across the finance tabs don't need to change their import.
 */
export function Field({
  id,
  label,
  wide = false,
  required = false,
  optional = false,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <FormField
      label={label}
      htmlFor={id}
      required={required}
      optional={optional}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(wide ? { className: "sm:col-span-2" } : {})}
    >
      {children}
    </FormField>
  );
}

/** A selectable option (for the shared Combobox). */
export interface Option {
  readonly id: string;
  readonly name: string;
}

/** A searchable select over a set of options, with a blank ("none") entry. */
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
    <Combobox
      id={id}
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      placeholder={DASH}
      options={[
        { value: "", label: DASH },
        ...options.map((o) => ({ value: o.id, label: o.name })),
      ]}
    />
  );
}
