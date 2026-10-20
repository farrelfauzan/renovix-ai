import { randomBytes } from "node:crypto";

/** 32 random bytes per invitation token (RX-95). */
const TOKEN_BYTES = 32;

/** A new invitation token, base64url. Only its SHA-256 hash (`hashToken`) is stored. */
export function newInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}
