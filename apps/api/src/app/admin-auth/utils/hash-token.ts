import { createHash } from "node:crypto";

/** SHA-256 hex of a high-entropy token (refresh token, recovery code). Not for passwords. */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
