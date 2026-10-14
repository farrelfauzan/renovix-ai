import { readRequiredSecret } from "./read-required-secret";

const KEY_BYTES = 32;
const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

/**
 * A 32-byte AES-256 key from a required secret (RX-110): 64 hex or 44 base64 characters, never
 * padded or truncated. Missing, empty or (outside development and test) a placeholder is refused
 * as by `readRequiredSecret`. Errors name the variable, never its value.
 */
export function readEncryptionKey(env: NodeJS.ProcessEnv, name: string): Buffer {
  const value = readRequiredSecret(env, name, 0);
  const key = HEX_KEY.test(value)
    ? Buffer.from(value, "hex")
    : BASE64_KEY.test(value)
      ? Buffer.from(value, "base64")
      : undefined;
  if (key?.length !== KEY_BYTES) {
    throw new Error(`${name} must decode to exactly ${KEY_BYTES} bytes (64 hex or 44 base64 characters)`);
  }
  return key;
}
