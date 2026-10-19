import { readEncryptionKey } from "./read-encryption-key";
import { readRequiredSecret } from "./read-required-secret";

/**
 * Refuses to start the API (RX-110) when an auth or encryption secret is missing, empty, or,
 * outside development and test, a placeholder, too short, or (MCP_ENCRYPTION_KEY, LLM_KEY_ENCRYPTION_KEY)
 * not 32 bytes.
 * Runs first in bootstrap; the services read the same values through the same helpers.
 */
export function assertRequiredSecrets(env: NodeJS.ProcessEnv): void {
  readRequiredSecret(env, "JWT_SECRET");
  readRequiredSecret(env, "BETTER_AUTH_SECRET");
  readRequiredSecret(env, "IP_HASH_SECRET");
  readEncryptionKey(env, "MCP_ENCRYPTION_KEY");
  readRequiredSecret(env, "MCP_OAUTH_STATE_SECRET");
  readEncryptionKey(env, "LLM_KEY_ENCRYPTION_KEY");
}
