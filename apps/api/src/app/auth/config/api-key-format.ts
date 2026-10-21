/**
 * The API key format (RNX-18): `rnx_live_` followed by the lowercase hex of `randomBytes` random bytes (76 hex
 * characters). Its first `prefixLength` hex characters are the key's prefix: stored as is, unique, the lookup.
 * Letters and digits only after the marker, so the redaction and log-masking patterns cover the whole key.
 */
export const API_KEY_FORMAT = { marker: "rnx_live_", randomBytes: 38, prefixLength: 12 } as const;
