import { createHash } from "node:crypto";

/** The lowercase hex SHA-256 of the bytes (RNX-35: a webhook's raw body is kept only as this hash). */
export const sha256Hex = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
