import { z } from "zod";

/** Base64url of 32 random bytes: the one-time value of an OAuth flow. */
const NONCE = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const ID = z.string().min(1).max(100);

/**
 * The signed payload of an MCP OAuth `state` (RX-151): one-time value, user id, workspace id,
 * provider and expiry (unix seconds). Only a payload whose signature checked out is parsed with it.
 */
export const OAuthStatePayload = z.strictObject({
  n: NONCE,
  u: ID,
  w: ID,
  p: ID,
  exp: z.number().int().positive(),
});
export type OAuthStatePayload = z.infer<typeof OAuthStatePayload>;
