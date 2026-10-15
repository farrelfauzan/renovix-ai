import { createHmac, timingSafeEqual } from "node:crypto";
import { OAuthStatePayload } from "../dto/oauth-state-payload.dto";

/**
 * The payload of an MCP OAuth `state` made by `signOAuthState` (RX-151), or null when it is not
 * `<payload>.<signature>`, the signature does not match (constant-time compare), the payload is not
 * the expected shape, or it expired at `nowSeconds` (unix seconds).
 */
export function verifyOAuthState(state: string, secret: string, nowSeconds: number): OAuthStatePayload | null {
  const [encodedPayload, signature, ...rest] = state.split(".");
  if (!encodedPayload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(encodedPayload).digest("base64url"));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const parsed = OAuthStatePayload.safeParse(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));
  if (!parsed.success || parsed.data.exp <= nowSeconds) return null;
  return parsed.data;
}
