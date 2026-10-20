import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { BUILT_IN_ROLES } from "../config/built-in-roles";
import { AdminInvitationRepository } from "../repository/admin-invitation.repository";
import { AdminRecoveryCodeRepository } from "../repository/admin-recovery-code.repository";
import { AdminUserRepository } from "../repository/admin-user.repository";
import type { AdminAuditChange } from "../types/admin-audit-change";
import type { AdminListEntry } from "../types/admin-list-entry";
import { toAdminListEntry } from "../utils/to-admin-list-entry";
import { toInvitedListEntry } from "../utils/to-invited-list-entry";
import { AdminSessionService } from "./admin-session.service";

/**
 * Owner management of back-office admins (RX-95): the admin list (admins and pending invitations), suspend
 * and reactivate, MFA reset and forced password reset. Removing an admin is a suspension; no admin row is
 * ever deleted (D123). Each write runs in the caller's audit transaction and returns its audit change.
 */
@Injectable()
export class AdminManagementService {
  constructor(
    private readonly admins: AdminUserRepository,
    private readonly invitations: AdminInvitationRepository,
    private readonly recoveryCodes: AdminRecoveryCodeRepository,
    private readonly sessions: AdminSessionService,
  ) {}

  /** Every admin, then every pending invitation (status "invited"): two queries, whatever the count. */
  async list(): Promise<AdminListEntry[]> {
    const [admins, invitations] = await Promise.all([this.admins.listForManagement(), this.invitations.listPending()]);
    return [...admins.map(toAdminListEntry), ...invitations.map(toInvitedListEntry)];
  }

  /**
   * Suspends the admin and ends all their sessions. 403 for oneself, 404 unknown, 409 already suspended or
   * the last active owner (the active owners' rows are locked first, so two parallel suspensions cannot
   * both pass).
   */
  async suspend(actorAdminId: string, adminId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    if (actorAdminId === adminId) throw new ForbiddenException("You cannot suspend yourself");
    const owners = await this.admins.lockActiveIdsWithRole(BUILT_IN_ROLES.owner, tx);
    const admin = await this.admins.findById(adminId, tx);
    if (!admin) throw new NotFoundException();
    if (owners.length === 1 && owners[0] === adminId) throw new ConflictException("At least one active owner must remain");
    if ((await this.admins.suspend(adminId, new Date(), tx)) === 0) throw new ConflictException("The admin is already suspended");
    const sessionsEnded = await this.sessions.endAllForAdmin(adminId, tx);
    return { before: { adminId, status: "active" }, after: { adminId, status: "suspended", sessionsEnded } };
  }

  /** Lifts a suspension. 404 unknown, 409 not suspended. */
  async reactivate(adminId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    if (!(await this.admins.findById(adminId, tx))) throw new NotFoundException();
    if ((await this.admins.reactivate(adminId, tx)) === 0) throw new ConflictException("The admin is not suspended");
    return { before: { adminId, status: "suspended" }, after: { adminId, status: "active" } };
  }

  /** Removes the admin's TOTP and recovery codes and ends their sessions: the next sign-in enrols again. 404 unknown. */
  async resetMfa(adminId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    const admin = await this.admins.findById(adminId, tx);
    if (!admin) throw new NotFoundException();
    await this.admins.resetTotp(adminId, tx);
    const recoveryCodesRemoved = await this.recoveryCodes.deleteAll(adminId, tx);
    const sessionsEnded = await this.sessions.endAllForAdmin(adminId, tx);
    return {
      before: { adminId, totpEnrolled: admin.totpEnrolledAt !== null },
      after: { adminId, totpEnrolled: false, recoveryCodesRemoved, sessionsEnded },
    };
  }

  /** Forces a password change at the admin's next sign-in and ends their sessions. 404 unknown. */
  async forcePasswordReset(adminId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    const admin = await this.admins.findById(adminId, tx);
    if (!admin) throw new NotFoundException();
    await this.admins.forcePasswordChange(adminId, tx);
    const sessionsEnded = await this.sessions.endAllForAdmin(adminId, tx);
    return {
      before: { adminId, mustChangePassword: admin.mustChangePassword },
      after: { adminId, mustChangePassword: true, sessionsEnded },
    };
  }
}
