/** A snake_case column name in camelCase ("cost_low_usd" → "costLowUsd"). */
export function toCamelCase(column: string): string {
  return column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
