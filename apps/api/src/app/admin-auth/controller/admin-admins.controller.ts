import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../decorator/admin-audit.decorator";
import { AssignRoleDto } from "../dto/assign-role.dto";
import { AdminManagementService } from "../service/admin-management.service";
import { AdminRoleService } from "../service/admin-role.service";
import type { AuditedAdminRequest } from "../types/audited-admin-request";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * Admin management (RX-95) under /api/v1/admin/admins. The list needs `admins:read`; every write needs
 * `admins:write` (Owners only among the built-in roles) and is audited. Suspend, MFA reset and forced
 * password reset also need a re-authentication within REAUTH_WINDOW_MINUTES (`reauth: true`). Removing an
 * admin is a suspension: no route deletes an admin. Role assignment (RNX-187) needs `roles:write` and a
 * re-authentication.
 */
@Controller("admin/admins")
export class AdminAdminsController {
  constructor(
    private readonly management: AdminManagementService,
    private readonly roles: AdminRoleService,
  ) {}

  /** Admins (active, suspended) and pending invitations (invited): name, email, role, MFA, last sign-in, status. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["admins:read"] })
  async list() {
    return { admins: await this.management.list() };
  }

  /** Suspends the admin (also "remove") and ends their sessions. Not oneself, not the last active owner. */
  @Post(":id/suspend")
  @Access({ auth: ["staff"], permissions: ["admins:write"], reauth: true })
  @AdminAudit({ resource: "admin_user", action: "suspend" })
  @HttpCode(204)
  async suspend(@Param("id") id: string, @Req() req: AuditedAdminRequest) {
    req.audit.record(await this.management.suspend(req.admin.adminId, id, req.audit.tx));
  }

  /** Lifts a suspension. */
  @Post(":id/reactivate")
  @Access({ auth: ["staff"], permissions: ["admins:write"] })
  @AdminAudit({ resource: "admin_user", action: "reactivate" })
  @HttpCode(204)
  async reactivate(@Param("id") id: string, @Req() req: AuditedAdminRequest) {
    req.audit.record(await this.management.reactivate(id, req.audit.tx));
  }

  /** Removes the admin's TOTP and recovery codes and ends their sessions; they enrol again at the next sign-in. */
  @Post(":id/reset-mfa")
  @Access({ auth: ["staff"], permissions: ["admins:write"], reauth: true })
  @AdminAudit({ resource: "admin_user", action: "reset_mfa" })
  @HttpCode(204)
  async resetMfa(@Param("id") id: string, @Req() req: AuditedAdminRequest) {
    req.audit.record(await this.management.resetMfa(id, req.audit.tx));
  }

  /** Forces a password change at the admin's next sign-in and ends their sessions. */
  @Post(":id/force-password-reset")
  @Access({ auth: ["staff"], permissions: ["admins:write"], reauth: true })
  @AdminAudit({ resource: "admin_user", action: "force_password_reset" })
  @HttpCode(204)
  async forcePasswordReset(@Param("id") id: string, @Req() req: AuditedAdminRequest) {
    req.audit.record(await this.management.forcePasswordReset(id, req.audit.tx));
  }

  /**
   * Gives the admin a role (RNX-187). Not one's own role (403), not away from the last active owner (409).
   * Every assignment needs a recent re-authentication, not only those that give or take Owner.
   */
  @Put(":id/role")
  @Access({ auth: ["staff"], permissions: ["roles:write"], reauth: true })
  @AdminAudit({ resource: "admin_user", action: "assign_role" })
  @HttpCode(204)
  async assignRole(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest) {
    const parsed = AssignRoleDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    req.audit.record(await this.roles.assignRole(id, parsed.data.role, req.admin.adminId, req.audit.tx));
  }
}
