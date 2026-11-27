import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AdminRequest } from "../../admin-auth/types/admin-request";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { AdminWriteReasonDto } from "../../admin-auth/dto/admin-write-reason.dto";
import { ListUsersQueryDto } from "../dto/list-users-query.dto";
import { UserRevealBodyDto } from "../dto/user-reveal-body.dto";
import { AdminUsersService } from "../service/admin-users.service";
import type { AdminUserDetail } from "../types/admin-user-detail";
import type { AdminUserPage } from "../types/admin-user-page";
import type { RevokedCount } from "../types/revoked-count";
import type { UserRevealView } from "../types/user-reveal-view";
import { parseRouteId } from "../utils/parse-route-id";

/**
 * End users in the back office (RNX-357). Under /api/v1/admin/users, the reads and the reveal need `users:read`. Email,
 * phone and name are masked; revealing one is a separate, audited request that needs `users:read_pii` or, for Support,
 * an unexpired per-user grant (checked in the service). The detail's ledger needs `credits:read` too. RNX-100: suspend,
 * reinstate and the API key reset need `users:write`, take a required `reason` (checked before anything changes) and
 * are audited with it; no re-authentication is asked for them.
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

  /** Suspends an active user and ends all their sessions (`{ reason }`). 404 unknown or deleted, 409 already suspended. */
  @Post(":id/suspend")
  @HttpCode(204)
  @Access({ auth: ["staff"], permissions: ["users:write"] })
  @AdminAudit({ resource: "user", action: "suspend" })
  async suspend(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<void> {
    const userId = parseRouteId(id);
    const parsed = AdminWriteReasonDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    req.audit.record({ ...(await this.users.suspend(userId, req.audit.tx)), reason: parsed.data.reason });
  }

  /** Lifts a suspension (`{ reason }`); sessions and keys are not restored. 404 unknown or deleted, 409 not suspended. */
  @Post(":id/reinstate")
  @HttpCode(204)
  @Access({ auth: ["staff"], permissions: ["users:write"] })
  @AdminAudit({ resource: "user", action: "reinstate" })
  async reinstate(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<void> {
    const userId = parseRouteId(id);
    const parsed = AdminWriteReasonDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    req.audit.record({ ...(await this.users.reinstate(userId, req.audit.tx)), reason: parsed.data.reason });
  }

  /** Revokes every unrevoked API key of the user (`{ reason }`) and answers `{ revoked }`, how many. 404 unknown or deleted. */
  @Post(":id/reset-api-keys")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["users:write"] })
  @AdminAudit({ resource: "user_api_key", action: "reset" })
  async resetApiKeys(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<RevokedCount> {
    const userId = parseRouteId(id);
    const parsed = AdminWriteReasonDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.users.resetApiKeys(userId, req.audit.tx);
    req.audit.record({ ...change, reason: parsed.data.reason });
    return result;
  }
}
