/** Serialize a flat options object into a `?a=1&b=2` query string, omitting undefined/empty values. */
export function buildQuery(options: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text.length === 0) continue;
    params.set(key, text);
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}
