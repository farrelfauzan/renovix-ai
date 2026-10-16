export function truncate(value: string, max: number): string {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}
