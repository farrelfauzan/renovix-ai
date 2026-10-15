import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import type { AdminUser } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import type { ReauthDto } from "../dto/reauth.dto";
import type { SignInDto } from "../dto/sign-in.dto";
import { AdminNotificationRepository } from "../repository/admin-notification.repository";
import { AdminRecoveryCodeRepository } from "../repository/admin-recovery-code.repository";
import { AdminUserRepository } from "../repository/admin-user.repository";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import type { AdminIdentity } from "../types/admin-identity";
import type { IssuedAdminSession } from "../types/issued-admin-session";
import { hashToken } from "../utils/hash-token";
import { isLocked } from "../utils/is-locked";
import { normalizeRecoveryCode } from "../utils/normalize-recovery-code";
import { AdminSessionService } from "./admin-session.service";
import { PasswordService } from "./password.service";
import { TotpService } from "./totp.service";

/** The one answer to every failed sign-in, whatever failed, so accounts cannot be told apart (RX-94). */
const INVALID_CREDENTIALS = "Invalid credentials";
const MS_PER_MINUTE = 60_000;

/**
 * Back-office sign-in (RX-94, D53): email + password + TOTP or a recovery code; before TOTP is enrolled,
 * password alone gives an enrolment-only session. Wrong password and wrong or missing second factor count
 * as failures; at the limit the account locks and the owner role gets a notification.
 */
@Injectable()
export class AdminSignInService {
  private readonly logger = new Logger(AdminSignInService.name);

  constructor(
    private readonly admins: AdminUserRepository,
    private readonly recoveryCodes: AdminRecoveryCodeRepository,
    private readonly notifications: AdminNotificationRepository,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly sessions: AdminSessionService,
    private readonly transactions: TransactionService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly settings: AdminAuthConfig,
  ) {}

  /** Signs in; every failure (unknown email, wrong password or factor, locked) is the same 401. */
  async signIn(input: SignInDto, userAgent: string | undefined): Promise<IssuedAdminSession> {
    const admin = await this.admins.findByEmail(input.email.trim().toLowerCase());
    const passwordOk = await this.passwords.verify(admin?.passwordHash, input.password);
    if (!admin || isLocked(admin.lockedUntil, new Date())) throw new UnauthorizedException(INVALID_CREDENTIALS);
    if (!passwordOk) return this.fail(admin.id);
    if (!admin.totpEnrolledAt) return this.succeed(admin.id, "enrolment", userAgent);
    if (!(await this.checkSecondFactor(admin, input))) return this.fail(admin.id);
    return this.succeed(admin.id, "full", userAgent);
  }

  /**
   * Re-authentication on a full session: password and a fresh TOTP code; failures count like sign-in failures
   * (in their own transaction, so a failure is counted even though the request fails). `tx`: the audit
   * transaction the success is recorded in (RX-97).
   */
  async reauth(identity: AdminIdentity, input: ReauthDto, tx?: DbTransaction): Promise<void> {
    const admin = await this.admins.findById(identity.adminId);
    const passwordOk = await this.passwords.verify(admin?.passwordHash, input.password);
    if (!admin || isLocked(admin.lockedUntil, new Date())) throw new UnauthorizedException(INVALID_CREDENTIALS);
    if (!passwordOk || !(await this.totp.accept(admin, input.totp))) return this.fail(admin.id);
    await this.assertStillUnlocked(admin.id);
    await this.sessions.markReauth(identity.sessionId, tx);
  }

  private async checkSecondFactor(admin: AdminUser, input: SignInDto): Promise<boolean> {
    if (input.totp) return this.totp.accept(admin, input.totp);
    if (!input.recoveryCode) return false;
    const codeHash = hashToken(normalizeRecoveryCode(input.recoveryCode));
    return (await this.recoveryCodes.useCode(admin.id, codeHash, new Date())) === 1;
  }

  private async succeed(adminId: string, scope: string, userAgent: string | undefined): Promise<IssuedAdminSession> {
    await this.assertStillUnlocked(adminId);
    return this.sessions.start(adminId, scope, userAgent);
  }

  /** The lock is read before the slow password check; this decides again at the end, atomically: locked meanwhile → the same 401. */
  private async assertStillUnlocked(adminId: string): Promise<void> {
    if ((await this.admins.clearFailuresIfUnlocked(adminId, new Date())) === 0) throw new UnauthorizedException(INVALID_CREDENTIALS);
  }

  /** Counts the failure, locks at the limit (one owner notification per lock), then answers the same 401. */
  private async fail(adminId: string): Promise<never> {
    const lockedUntil = new Date(Date.now() + this.settings.lockoutMinutes * MS_PER_MINUTE);
    const locked = await this.transactions.run(async (tx) => {
      const row = await this.admins.incrementFailedAttempts(adminId, tx);
      if (row.failedAttempts < this.settings.maxFailedAttempts) return false;
      if ((await this.admins.lockIfOverLimit(adminId, this.settings.maxFailedAttempts, lockedUntil, tx)) === 0) return false;
      await this.notifications.create("owner", "lockout", adminId, tx);
      return true;
    });
    if (locked) {
      this.logger.warn(
        `Back-office account ${adminId} locked for ${this.settings.lockoutMinutes} minutes after ${this.settings.maxFailedAttempts} failed sign-in attempts; owner notification recorded`,
      );
    }
    throw new UnauthorizedException(INVALID_CREDENTIALS);
  }
}
