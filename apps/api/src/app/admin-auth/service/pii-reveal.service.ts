import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { BUILT_IN_ROLES } from "../config/built-in-roles";
import { PiiRevealReasonDto } from "../dto/pii-reveal-reason.dto";
import { AdminAuditLogRepository } from "../repository/admin-audit-log.repository";
import { AdminPiiGrantRepository } from "../repository/admin-pii-grant.repository";
import { AdminRoleRepository } from "../repository/admin-role.repository";
import type { AdminIdentity } from "../types/admin-identity";

/** The permission that unmasks a user's personal data (PRD 09 F8). */
const READ_PII = "users:read_pii";

/** Who may reveal a user's personal data (RX-96, D56). No route reveals any yet (RX-95 and later). */
@Injectable()
export class PiiRevealService {
  constructor(
    private readonly roles: AdminRoleRepository,
    private readonly grants: AdminPiiGrantRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  /**
   * True when the admin's role holds `users:read_pii` (owner and operations by default), or the admin is
   * Support and holds an unexpired grant for this user; false otherwise.
   */
  async canRevealPii(admin: AdminIdentity, subjectUserId: string): Promise<boolean> {
    if (await this.holdsReadPii(admin)) return true;
    if (admin.role !== BUILT_IN_ROLES.support) return false;
    return (await this.grants.countActive(admin.adminId, subjectUserId, new Date())) > 0;
  }

  /**
   * True when the admin's role holds `users:read_pii` (owner and operations by default), read on this
   * request. Not per user: Support's per-user grants are left out (RX-164 uses it for the audit log).
   */
  async holdsReadPii(admin: AdminIdentity): Promise<boolean> {
    const role = await this.roles.findByName(admin.role);
    return role?.permissions.includes(READ_PII) === true;
  }

  /**
   * The step before a personal-data reveal (RX-97, D56, D57). `reason` is checked here, as the request gave
   * it: 400 without one (required, at most 500 characters); 403 when `canRevealPii` refuses, and no audit
   * row; otherwise one audit row naming the admin, the user, the reason and the time, written before
   * anything is revealed.
   */
  async authorizeReveal(admin: AdminIdentity, subjectUserId: string, reason: unknown, requestId: string): Promise<void> {
    const parsed = PiiRevealReasonDto.safeParse(reason);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().formErrors);
    if (!(await this.canRevealPii(admin, subjectUserId))) throw new ForbiddenException();
    await this.auditLog.create({
      adminId: admin.adminId,
      resource: "user_pii",
      action: "reveal",
      before: { userId: subjectUserId, revealed: false },
      after: { userId: subjectUserId, revealed: true },
      reason: parsed.data,
      requestId,
      effectiveAt: new Date(),
    });
  }
}
