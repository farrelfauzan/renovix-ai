import { API_KEY_FORMAT } from "../config/api-key-format";

const KEY_PATTERN = new RegExp(`^${API_KEY_FORMAT.marker}([0-9a-f]{${API_KEY_FORMAT.randomBytes * 2}})$`);

/** RNX-18: the prefix (lookup) of a presented API key, or null when it is not `rnx_live_` + 76 lowercase hex. */
export function parseApiKeyPrefix(presented: string): string | null {
  const match = KEY_PATTERN.exec(presented);
  return match ? match[1].slice(0, API_KEY_FORMAT.prefixLength) : null;
}
