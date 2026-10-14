import { PositiveIntegerSetting } from "../types/positive-integer-setting";

/**
 * The value of an optional positive-integer setting (RX-160): unset or empty gives the
 * fallback; anything that is not a positive integer is refused with an error naming the variable.
 */
export function readPositiveInteger({ name, value, fallback }: PositiveIntegerSetting): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer (got "${value}")`);
  }
  return parsed;
}
