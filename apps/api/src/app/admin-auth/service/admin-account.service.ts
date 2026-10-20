import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { AdminUserRepository } from "../repository/admin-user.repository";
import type { AdminIdentity } from "../types/admin-identity";
import type { AdminProfile } from "../types/admin-profile";
import type { IssuedAdminSession } from "../types/issued-admin-session";
import { AdminSessionService } from "./admin-session.service";
import { PasswordService } from "./password.service";

/** The signed-in admin's own account (RX-95): who they are, and the password change after a forced reset. */
@Injectable()
export class AdminAccountService {
  constructor(
    private readonly admins: AdminUserRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: AdminSessionService,
  ) {}

  /** The admin, their role's permissions and whether a password change is forced. */
  async profile(identity: AdminIdentity): Promise<AdminProfile> {
    const admin = await this.admins.findWithPermissions(identity.adminId);
    if (!admin) throw new UnauthorizedException("Authentication required");
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      permissions: admin.adminRole.permissions,
      scope: identity.scope,
      mfaEnrolled: admin.totpEnrolledAt !== null,
      mustChangePassword: admin.mustChangePassword,
    };
  }

  /**
   * Sets a new password (the RX-94 rules, and not the current one), clears the forced reset, ends every
   * session of the admin and starts a full one: the session proved password and TOTP at sign-in.
   */
  async changePassword(identity: AdminIdentity, newPassword: string, userAgent: string | undefined, tx: DbTransaction): Promise<IssuedAdminSession> {
    const admin = await this.admins.findById(identity.adminId, tx);
    if (!admin) throw new UnauthorizedException("Authentication required");
    this.passwords.assertAcceptable(newPassword, admin.email);
    if (await this.passwords.verify(admin.passwordHash, newPassword)) throw new BadRequestException("Choose a new password, not the current one.");
    await this.admins.changePassword(admin.id, await this.passwords.hash(newPassword), tx);
    await this.sessions.endAllForAdmin(admin.id, tx);
    return this.sessions.start(admin.id, "full", userAgent, tx);
  }
}
