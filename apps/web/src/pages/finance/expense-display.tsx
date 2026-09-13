import type { ReactNode } from "react";
import { expenseCategoryStyle, tint, tintText } from "@/features/finance/expense-category-style";
import { cn } from "@/lib/cn";
import { formatMoney } from "./finance-shared";

/**
 * A minor-unit amount with its currency code after it. Takes the locale and
 * unit as props rather than reading them from context, so grid column
 * renderers can use it outside a provider.
 */
export function CurrencyAmount({
  minor,
  locale,
  unit,
  className,
}: {
  readonly minor: number;
  readonly locale: string;
  readonly unit: string;
  readonly className?: string;
}): ReactNode {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      <span>{formatMoney(minor, locale)}</span>{" "}
      <span className="text-[0.7em] font-medium text-muted-foreground">{unit}</span>
    </span>
  );
}

/** An expense category as a tinted chip with its icon. */
export function ExpenseCategoryChip({ category }: { readonly category: string }): ReactNode {
  const { icon: Icon, color } = expenseCategoryStyle(category);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: tint(color, 14), color: tintText(color) }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{category}</span>
    </span>
  );
}
