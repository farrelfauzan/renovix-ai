import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminSessionModule } from "./admin-session.module";
import { AdminAdminsController } from "./controller/admin-admins.controller";
import { AdminAuditLogController } from "./controller/admin-audit-log.controller";
import { AdminAuthController } from "./controller/admin-auth.controller";
import { AdminInvitationsController } from "./controller/admin-invitations.controller";
import { AdminAccountService } from "./service/admin-account.service";
import { AdminAuditLogService } from "./service/admin-audit-log.service";
import { AdminEnrolmentService } from "./service/admin-enrolment.service";
import { AdminInvitationService } from "./service/admin-invitation.service";
import { AdminManagementService } from "./service/admin-management.service";
import { AdminRoleService } from "./service/admin-role.service";
import { AdminSignInService } from "./service/admin-sign-in.service";
import { PasswordService } from "./service/password.service";
import { PiiRevealService } from "./service/pii-reveal.service";
import { TotpService } from "./service/totp.service";

/**
 * Back-office identity (RX-94): sign-in with password and TOTP, enrolment, recovery codes, lockout and
 * the session routes under /admin/auth. Needs ADMIN_JWT_SECRET and ADMIN_TOTP_ENCRYPTION_KEY (no fallback).
 * Roles (RX-96): role assignment with at least one owner, and who may reveal personal data (D56); the
 * permission check itself runs in AccessGuard through AdminSessionModule. Audit (RX-97): every write of
 * a signed-in admin and every personal-data reveal writes a row of the append-only audit log (AdminAuditModule).
 * Audit log screen (RX-164): the read route and the CSV export under /admin/audit-log.
 * Admin management (RX-95): invitations under /admin/invitations, the admin list, suspension and resets under
 * /admin/admins, and the admin's own profile and forced password change under /admin/auth.
 */
@Module({
  imports: [ConfigModule, AdminSessionModule],
  controllers: [AdminAuthController, AdminAuditLogController, AdminInvitationsController, AdminAdminsController],
  providers: [
    PasswordService,
    TotpService,
    AdminSignInService,
    AdminEnrolmentService,
    AdminRoleService,
    PiiRevealService,
    AdminAuditLogService,
    AdminInvitationService,
    AdminManagementService,
    AdminAccountService,
  ],
})
export class AdminAuthModule {}
