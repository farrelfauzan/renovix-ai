/** The marker every Renovix API key starts with; the API stores only the 12 characters after it as the prefix. */
const KEY_MARKER = "rnx_live_";

/** How a key is shown once its full value is gone: the marker, its stored prefix and an ellipsis. */
export function formatKeyPrefix(prefix: string): string {
  return `${KEY_MARKER}${prefix}…`;
}
