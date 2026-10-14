import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import type { AdminUser } from "@generated/prisma/client.js";
import { AdminUserRepository } from "../repository/admin-user.repository";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import type { NewTotpSecret } from "../types/new-totp-secret";

const ISSUER = "Renovix Admin";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Prefix of the stored form, so the format can change later. */
const FORMAT = "v1.";

/**
 * TOTP of the back office (RX-94, D53): enrolment secrets, encrypted at rest with AES-256-GCM under
 * ADMIN_TOTP_ENCRYPTION_KEY (32 bytes, base64; no fallback: the module does not start without it), and
 * verification with a one-step tolerance that refuses a step already used.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly key: Buffer;

  constructor(
    config: ConfigService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly settings: AdminAuthConfig,
    private readonly admins: AdminUserRepository,
  ) {
    this.key = Buffer.from(config.getOrThrow<string>("ADMIN_TOTP_ENCRYPTION_KEY"), "base64");
    if (this.key.length !== KEY_BYTES) {
      throw new Error(`ADMIN_TOTP_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded`);
    }
  }

  /** A new secret for this admin: the base32 secret, its otpauth URI (for the QR code) and its encrypted form to store. */
  createSecret(adminId: string, email: string): NewTotpSecret {
    const secret = generateSecret();
    const otpauthUri = generateURI({ issuer: ISSUER, label: email, secret });
    return { secret, otpauthUri, encrypted: this.encrypt(secret, adminId) };
  }

  /**
   * True when `code` is valid for the admin's stored secret (one step either side) and its step is later
   * than the last accepted one; that step is then recorded with a conditional update, so the same code
   * cannot be used twice, not even by two requests at once.
   */
  async accept(admin: Pick<AdminUser, "id" | "totpSecretEncrypted" | "lastAcceptedTimeStep">, code: string): Promise<boolean> {
    const step = await this.matchStep(admin, code);
    return step !== null && (await this.admins.acceptTimeStep(admin.id, step)) === 1;
  }

  /**
   * The step `code` matches, or null. An error here (a secret that does not decrypt, otplib refusing a stored
   * step outside its window) is a failed second factor, not a 500: the password has already matched, and a
   * different answer would say so. Logged with the error's name only.
   */
  private async matchStep(admin: Pick<AdminUser, "id" | "totpSecretEncrypted" | "lastAcceptedTimeStep">, code: string): Promise<number | null> {
    if (!admin.totpSecretEncrypted) return null;
    try {
      const result = await verify({
        secret: this.decrypt(admin.totpSecretEncrypted, admin.id),
        token: code,
        epochTolerance: this.settings.totpToleranceSeconds,
        afterTimeStep: admin.lastAcceptedTimeStep ?? undefined,
      });
      return result.valid && "timeStep" in result ? result.timeStep : null; // the TOTP result carries the matched step
    } catch (err) {
      this.logger.warn(`TOTP check failed for admin ${admin.id}: ${err instanceof Error ? err.name : "unknown error"}`);
      return null;
    }
  }

  /** AES-256-GCM with the admin id as associated data, so a secret cannot be moved to another admin's row. */
  private encrypt(plain: string, adminId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv).setAAD(Buffer.from(adminId));
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return FORMAT + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }

  private decrypt(stored: string, adminId: string): string {
    const data = Buffer.from(stored.slice(FORMAT.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES }).setAAD(
      Buffer.from(adminId),
    );
    decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  }
}
