import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readEncryptionKey } from "../../../common/utils/read-encryption-key";
import { readPositiveInteger } from "../../../common/utils/read-positive-integer";
import type { SealedApiKey } from "../types/sealed-api-key";

const CIPHER_ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DEFAULT_KEY_VERSION = 1;

/**
 * Encrypts provider API keys at rest (RX-177, ported from HMS's AiProviderCryptoService): AES-256-GCM,
 * a random 12-byte IV per seal, stored as base64(iv || tag || ciphertext). The key is
 * LLM_KEY_ENCRYPTION_KEY (required, 32 bytes, checked at boot by assertRequiredSecrets); its version is
 * LLM_KEY_VERSION (a positive integer, default 1). No AAD: the row id does not exist before the insert.
 * Only ProviderRepository uses it. Never logs a key, plaintext or sealed.
 */
@Injectable()
export class ProviderKeyCryptoService {
  private readonly key: Buffer = readEncryptionKey(process.env, "LLM_KEY_ENCRYPTION_KEY");
  private readonly keyVersion: number = readPositiveInteger({
    name: "LLM_KEY_VERSION",
    value: process.env.LLM_KEY_VERSION,
    fallback: DEFAULT_KEY_VERSION,
  });

  /** Seals one API key with a fresh IV. */
  seal(plaintext: string): SealedApiKey {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER_ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"), keyVersion: this.keyVersion };
  }

  /** Opens a sealed API key; throws on a truncated value or a tag that does not verify (tampered, or another key). */
  reveal(ciphertext: string): string {
    const payload = Buffer.from(ciphertext, "base64");
    if (payload.length <= IV_BYTES + AUTH_TAG_BYTES) throw new Error("Provider API key ciphertext is malformed");
    const decipher = createDecipheriv(CIPHER_ALGORITHM, this.key, payload.subarray(0, IV_BYTES));
    decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES));
    return Buffer.concat([decipher.update(payload.subarray(IV_BYTES + AUTH_TAG_BYTES)), decipher.final()]).toString("utf8");
  }
}
