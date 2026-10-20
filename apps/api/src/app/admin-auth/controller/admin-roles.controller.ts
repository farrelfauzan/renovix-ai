import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../decorator/admin-audit.decorator";
import { CreateRoleDto } from "../dto/create-role.dto";
import { UpdateRoleDto } from "../dto/update-role.dto";
import { AdminRoleService } from "../service/admin-role.service";
import type { AuditedAdminRequest } from "../types/audited-admin-request";

/**
 * Back-office roles (RNX-187) under /api/v1/admin/roles. The list needs `roles:read`; every write needs
 * `roles:write` (Owners only: no custom role may hold it) and is audited. Editing a role also needs a
 * re-authentication within REAUTH_WINDOW_MINUTES. The five built-in roles cannot be renamed, edited or
 * deleted (403). Role assignment is PUT /admin/admins/:id/role (AdminAdminsController).
 */
@Controller("admin/roles")
export class AdminRolesController {
  constructor(private readonly roles: AdminRoleService) {}

  /** Every role with its permissions and whether it is built in. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["roles:read"] })
  async list() {
    return { roles: await this.roles.list() };
  }

  /** Creates a custom role from STAFF_PERMISSIONS, without admins:write and roles:write (400). 409 name taken. */
  @Post()
  @Access({ auth: ["staff"], permissions: ["roles:write"] })
  @AdminAudit({ resource: "admin_role", action: "create" })
  @HttpCode(204)
  async create(@Body() body: unknown, @Req() req: AuditedAdminRequest) {
    const parsed = CreateRoleDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().fieldErrors);
    req.audit.record(await this.roles.create(parsed.data, req.audit.tx));
  }

  /** Renames a custom role and/or replaces its permissions (same rules as create); the admins holding it follow. */
  @Patch(":name")
  @Access({ auth: ["staff"], permissions: ["roles:write"], reauth: true })
  @AdminAudit({ resource: "admin_role", action: "update" })
  @HttpCode(204)
  async update(@Param("name") name: string, @Body() body: unknown, @Req() req: AuditedAdminRequest) {
    const parsed = UpdateRoleDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    req.audit.record(await this.roles.update(name, parsed.data, req.audit.tx));
  }

  /** Deletes a custom role nobody holds (409 while an admin or an invitation holds it). */
  @Delete(":name")
  @Access({ auth: ["staff"], permissions: ["roles:write"] })
  @AdminAudit({ resource: "admin_role", action: "delete" })
  @HttpCode(204)
  async delete(@Param("name") name: string, @Req() req: AuditedAdminRequest) {
    req.audit.record(await this.roles.delete(name, req.audit.tx));
  }
}
