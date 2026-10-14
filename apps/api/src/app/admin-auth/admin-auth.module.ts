import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminSessionModule } from "./admin-session.module";
import { AdminAuthController } from "./controller/admin-auth.controller";
import { AdminNotificationRepository } from "./repository/admin-notification.repository";
import { AdminRecoveryCodeRepository } from "./repository/admin-recovery-code.repository";
import { AdminUserRepository } from "./repository/admin-user.repository";
import { AdminEnrolmentService } from "./service/admin-enrolment.service";
import { AdminSignInService } from "./service/admin-sign-in.service";
import { PasswordService } from "./service/password.service";
import { TotpService } from "./service/totp.service";

/**
 * Back-office identity (RX-94): sign-in with password and TOTP, enrolment, recovery codes, lockout and
 * the session routes under /admin/auth. Needs ADMIN_JWT_SECRET and ADMIN_TOTP_ENCRYPTION_KEY (no fallback).
 */
@Module({
  imports: [ConfigModule, AdminSessionModule],
  controllers: [AdminAuthController],
  providers: [
    AdminUserRepository,
    AdminRecoveryCodeRepository,
    AdminNotificationRepository,
    PasswordService,
    TotpService,
    AdminSignInService,
    AdminEnrolmentService,
  ],
})
export class AdminAuthModule {}
