import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AdminRequest } from "../../admin-auth/types/admin-request";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { ListUsersQueryDto } from "../dto/list-users-query.dto";
import { UserRevealBodyDto } from "../dto/user-reveal-body.dto";
import { AdminUsersService } from "../service/admin-users.service";
import type { AdminUserDetail } from "../types/admin-user-detail";
import type { AdminUserPage } from "../types/admin-user-page";
import type { UserRevealView } from "../types/user-reveal-view";

/**
 * End users in the back office (RNX-357), API only. Under /api/v1/admin/users, every route needs `users:read`. Email,
 * phone and name are masked; revealing one is a separate, audited request that needs `users:read_pii` or, for Support,
 * an unexpired per-user grant (checked in the service). The detail's ledger needs `credits:read` too.
 */
@Controller("admin/users")
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /** One page of users: exact `email` or `id` lookup, `packageId` and `status` filters, `page` from 1. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["users:read"] })
  list(@Query() query: unknown): Promise<AdminUserPage> {
    const parsed = ListUsersQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.users.list(parsed.data);
  }

  /** One user with the personal data masked; 404 for an unknown or deleted user. */
  @Get(":id")
  @Access({ auth: ["staff"], permissions: ["users:read"] })
  detail(@Param("id") id: string, @Req() req: AdminRequest): Promise<AdminUserDetail> {
    return this.users.detail(req.admin, id);
  }

  /** Reveals one personal field (`{ field, reason }`); audited through the hook with the field and the reason. */
  @Post(":id/reveal")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["users:read"] })
  @AdminAudit({ resource: "user_pii", action: "reveal" })
  async reveal(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<UserRevealView> {
    const parsed = UserRevealBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.users.reveal({ admin: req.admin, userId: id, body: parsed.data }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
