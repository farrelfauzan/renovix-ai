import { readEncryptionKey } from "./read-encryption-key";
import { readRequiredSecret } from "./read-required-secret";

const ADMIN_TOTP_KEY_BYTES = 32;

/**
 * Refuses to start the API (RX-110) when an auth or encryption secret is missing, empty, or,
 * outside development and test, a placeholder, too short, or (MCP_ENCRYPTION_KEY, LLM_KEY_ENCRYPTION_KEY)
 * not 32 bytes; ADMIN_JWT_SECRET and ADMIN_TOTP_ENCRYPTION_KEY (RNX-43) are checked here too, and every one is
 * refused with leading or trailing whitespace (see `readRequiredSecret`).
 * Runs first in bootstrap; the services read the same values through the same helpers.
 */
export function assertRequiredSecrets(env: NodeJS.ProcessEnv): void {
  readRequiredSecret(env, "JWT_SECRET");
  readRequiredSecret(env, "BETTER_AUTH_SECRET");
  readRequiredSecret(env, "IP_HASH_SECRET");
  readEncryptionKey(env, "MCP_ENCRYPTION_KEY");
  readRequiredSecret(env, "MCP_OAUTH_STATE_SECRET");
  readEncryptionKey(env, "LLM_KEY_ENCRYPTION_KEY");
  readRequiredSecret(env, "API_KEY_HASH_SECRET");
  readRequiredSecret(env, "ADMIN_JWT_SECRET");
  readAdminTotpKey(env);
}

/** ADMIN_TOTP_ENCRYPTION_KEY: base64 of 32 bytes in every mode, as TotpService reads it (RX-94). */
function readAdminTotpKey(env: NodeJS.ProcessEnv): void {
  const value = readRequiredSecret(env, "ADMIN_TOTP_ENCRYPTION_KEY", 0);
  if (Buffer.from(value, "base64").length !== ADMIN_TOTP_KEY_BYTES) {
    throw new Error(`ADMIN_TOTP_ENCRYPTION_KEY must be ${ADMIN_TOTP_KEY_BYTES} bytes, base64-encoded`);
  }
}
