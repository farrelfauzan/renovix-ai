import { getPackageLimitMessage } from "./package-limit-message";

/** True when an axios error carries a PACKAGE_LIMIT_REACHED response body. */
export function isPackageLimitError(error: unknown): boolean {
  const data = (error as { response?: { data?: unknown } } | null | undefined)?.response?.data;
  return getPackageLimitMessage(data) !== null;
}
