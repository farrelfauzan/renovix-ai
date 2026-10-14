import { Injectable } from "@nestjs/common";
import { BUILT_IN_ROLES } from "../config/built-in-roles";
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
  ) {}

  /**
   * True when the admin's role holds `users:read_pii` (owner and operations by default), or the admin is
   * Support and holds an unexpired grant for this user; false otherwise.
   */
  async canRevealPii(admin: AdminIdentity, subjectUserId: string): Promise<boolean> {
    const role = await this.roles.findByName(admin.role);
    if (role?.permissions.includes(READ_PII)) return true;
    if (admin.role !== BUILT_IN_ROLES.support) return false;
    return (await this.grants.countActive(admin.adminId, subjectUserId, new Date())) > 0;
  }
}
