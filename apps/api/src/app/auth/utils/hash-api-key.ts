import { createHmac } from "crypto";

/** RNX-18: the keyed hash stored for an API key, HMAC-SHA256 of the whole key under API_KEY_HASH_SECRET, in hex. */
export const hashApiKey = (apiKey: string, secret: string): string =>
  createHmac("sha256", secret).update(apiKey).digest("hex");
