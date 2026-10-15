/** A value as text, so a Decimal column and the number it was written from compare equal. */
const asText = (value: unknown): string => (Array.isArray(value) ? JSON.stringify(value) : String(value));

/** True when `row` holds every value of `values` (only the keys of `values` are compared). */
export function hasSameValues(row: object, values: object): boolean {
  const columns = row as Record<string, unknown>;
  return Object.entries(values).every(([key, value]) => asText(columns[key]) === asText(value));
}
