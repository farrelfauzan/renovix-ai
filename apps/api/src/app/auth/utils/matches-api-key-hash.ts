import { timingSafeEqual } from "crypto";
import { hashApiKey } from "./hash-api-key";

/**
 * RNX-18: true when the presented key hashes to the stored hash. The two 32-byte digests are compared in constant
 * time (`crypto.timingSafeEqual`); a stored value of another length never matches.
 */
export function matchesApiKeyHash(presented: string, storedHash: string, secret: string): boolean {
  const actual = Buffer.from(hashApiKey(presented, secret), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
