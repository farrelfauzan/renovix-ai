import { createHmac } from "node:crypto";
import type { OAuthStatePayload } from "../dto/oauth-state-payload.dto";

/**
 * The MCP OAuth `state` (RX-151): `base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, base64url(payload)))`.
 */
export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}
