import { createHmac, timingSafeEqual } from "crypto";

const HMAC_SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Verify webhook signature: `signature` must be exactly the 64 hex characters of
 * HMAC-SHA256(secret, payload), nothing before or after. An empty secret never verifies.
 */
export function verifySignature(payload: string | Buffer, signature: string, secret: string): boolean {
  if (!secret || !HMAC_SHA256_HEX.test(signature)) return false;
  try {
    const expected = createHmac("sha256", secret).update(payload).digest();
    return timingSafeEqual(Buffer.from(signature, "hex"), expected);
  } catch {
    return false;
  }
}
