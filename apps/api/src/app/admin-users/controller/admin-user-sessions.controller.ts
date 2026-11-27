import { Body, Controller, Delete, Get, HttpCode, Param, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import { AdminWriteReasonDto } from "../../admin-auth/dto/admin-write-reason.dto";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { AdminUsersService } from "../service/admin-users.service";
import type { AdminUserSessionList } from "../types/admin-user-session-list";
import type { RevokedCount } from "../types/revoked-count";
import { parseRouteId } from "../utils/parse-route-id";

/**
 * A user's sessions in the back office (RNX-100), under /api/v1/admin/users/:id/sessions. The list needs `users:read`
 * (as the user detail) and answers no token or IP address. Revoking one session or all of them needs `users:write`,
 * takes a required `reason` in its JSON body (checked before anything changes) and is audited with it. 404 for an
 * unknown or deleted user.
 */
@Controller("admin/users/:id/sessions")
export class AdminUserSessionsController {
  constructor(private readonly users: AdminUsersService) {}

  /** The user's newest sessions: `{ sessions: [{ id, createdAt, expiresAt, userAgent }] }`, newest first. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["users:read"] })
  list(@Param("id") id: string): Promise<AdminUserSessionList> {
    return this.users.listSessions(parseRouteId(id));
  }

  /** Ends every session of the user (`{ reason }`) and answers `{ revoked }`, how many (0 when there was none). */
  @Delete()
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["users:write"] })
  @AdminAudit({ resource: "user_session", action: "revoke_all" })
  async revokeAll(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<RevokedCount> {
    const userId = parseRouteId(id);
    const parsed = AdminWriteReasonDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.users.revokeAllSessions(userId, req.audit.tx);
    req.audit.record({ ...change, reason: parsed.data.reason });
    return result;
  }

  /** Ends one session of the user (`{ reason }`); a session of another user, or none, is a 404. */
  @Delete(":sessionId")
  @HttpCode(204)
  @Access({ auth: ["staff"], permissions: ["users:write"] })
  @AdminAudit({ resource: "user_session", action: "revoke" })
  async revoke(@Param("id") id: string, @Param("sessionId") sessionId: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<void> {
    const userId = parseRouteId(id);
    const targetSessionId = parseRouteId(sessionId);
    const parsed = AdminWriteReasonDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    req.audit.record({ ...(await this.users.revokeSession(userId, targetSessionId, req.audit.tx)), reason: parsed.data.reason });
  }
}
