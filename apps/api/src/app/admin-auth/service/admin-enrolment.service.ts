import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { TransactionService } from "../../prisma/transaction.service";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import { AdminRecoveryCodeRepository } from "../repository/admin-recovery-code.repository";
import { AdminUserRepository } from "../repository/admin-user.repository";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import type { AdminIdentity } from "../types/admin-identity";
import type { EnrolmentResult } from "../types/enrolment-result";
import type { NewTotpSecret } from "../types/new-totp-secret";
import { hashToken } from "../utils/hash-token";
import { normalizeRecoveryCode } from "../utils/normalize-recovery-code";
import { AdminSessionService } from "./admin-session.service";
import { TotpService } from "./totp.service";

/** 8 random bytes per recovery code, shown as four groups of four hex digits (64 bits). */
const RECOVERY_CODE_BYTES = 8;

/**
 * TOTP enrolment of the back office (RX-94, D53), on an enrolment-only session: a new secret (otpauth URI
 * and manual secret), then the first code confirms it, issues the recovery codes once and replaces the
 * enrolment session by a full one. Re-enrolment of an enrolled admin is RX-95's admin management.
 */
@Injectable()
export class AdminEnrolmentService {
  constructor(
    private readonly admins: AdminUserRepository,
    private readonly recoveryCodes: AdminRecoveryCodeRepository,
    private readonly totp: TotpService,
    private readonly sessions: AdminSessionService,
    private readonly transactions: TransactionService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly settings: AdminAuthConfig,
  ) {}

  /** Makes and stores (encrypted, not active yet) a new secret; returns the otpauth URI and the base32 secret. */
  async enrol(identity: AdminIdentity): Promise<Omit<NewTotpSecret, "encrypted">> {
    const admin = await this.admins.findById(identity.adminId);
    if (!admin || admin.totpEnrolledAt) throw new ForbiddenException();
    const { secret, otpauthUri, encrypted } = this.totp.createSecret(admin.id, admin.email);
    if ((await this.admins.setPendingTotpSecret(admin.id, encrypted)) === 0) throw new ForbiddenException();
    return { otpauthUri, secret };
  }

  /** Confirms the secret with its first code: activates TOTP, issues the recovery codes, swaps the session. */
  async confirm(identity: AdminIdentity, code: string, userAgent: string | undefined): Promise<EnrolmentResult> {
    const admin = await this.admins.findById(identity.adminId);
    if (!admin || admin.totpEnrolledAt || !admin.totpSecretEncrypted) throw new BadRequestException("Start the enrolment first");
    if (!(await this.totp.accept(admin, code))) throw new BadRequestException("Invalid code");
    const codes = this.newRecoveryCodes();
    return this.transactions.run(async (tx) => {
      if ((await this.admins.markTotpEnrolled(admin.id, new Date(), tx)) === 0) throw new ConflictException();
      await this.recoveryCodes.replaceAll(admin.id, codes.map((c) => hashToken(normalizeRecoveryCode(c))), tx);
      await this.sessions.end(identity.sessionId, tx);
      return { recoveryCodes: codes, session: await this.sessions.start(admin.id, "full", userAgent, tx) };
    });
  }

  private newRecoveryCodes(): string[] {
    return Array.from({ length: this.settings.recoveryCodeCount }, () =>
      randomBytes(RECOVERY_CODE_BYTES).toString("hex").match(/.{4}/g)!.join("-"),
    );
  }
}
