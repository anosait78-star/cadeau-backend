/** Render a minor-unit amount (e.g. cents) as a localized 2-decimal currency string. */
export function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
