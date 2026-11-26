/** Narrows an unknown JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The message an API error body carries: its top-level `message`; otherwise `error.message`, with the names of the
 * fields in `error.details` appended (RNX-28, e.g. "Invalid request body: permissions, name"). Only the keys of
 * `details` are read, never their values, since they can hold submitted text. Null when the body has neither.
 */
export function readRefusalMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.message === "string") return body.message;
  const error = body.error;
  if (!isRecord(error) || typeof error.message !== "string") return null;
  const fieldNames = isRecord(error.details) ? Object.keys(error.details) : [];
  return fieldNames.length === 0 ? error.message : `${error.message}: ${fieldNames.join(", ")}`;
}
