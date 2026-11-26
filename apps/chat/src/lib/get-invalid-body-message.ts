const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Turns an invalid-body 400 (RNX-28) into "<error.message>: <field names>", naming the fields that failed.
 * Only the keys of `error.details` are used, never their values, which can hold submitted text.
 * Returns null for any other body.
 */
export function getInvalidBodyMessage(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const { message, details } = body.error;
  if (typeof message !== "string") return null;
  const fieldNames = isRecord(details) ? Object.keys(details) : [];
  return fieldNames.length > 0 ? `${message}: ${fieldNames.join(", ")}` : message;
}
