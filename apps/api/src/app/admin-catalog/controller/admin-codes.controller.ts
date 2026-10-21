import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { InvitationCode } from "@generated/prisma/client.js";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { CreateCodeDto } from "../../codes/dto/redeem-code.dto";
import { DeactivateCodeBodyDto } from "../dto/deactivate-code-body.dto";
import { ListCodesQueryDto } from "../dto/list-codes-query.dto";
import { AdminCodesService } from "../service/admin-codes.service";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * Invitation codes (RNX-226, D33), API only (the screens are RNX-98). Under /api/v1/admin/codes, staff only (the old
 * product routes stay removed, RX-66). No code permission exists in RX-96: a code grants credits or a plan, so every
 * route needs `packages:write`, the reads too: a code's text is a redeemable secret that read-only staff must not see.
 * Every write also needs a recent re-authentication (D250) and is audited through the hook (`req.audit.tx`).
 */
@Controller("admin/codes")
export class AdminCodesController {
  constructor(private readonly codes: AdminCodesService) {}

  /** One page of codes (`page`, `limit`), newest first, with the total. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["packages:write"] })
  list(@Query() query: unknown) {
    const parsed = ListCodesQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.codes.list(parsed.data);
  }

  /** Creates a code: credits (`topup`), a plan (`subscription`) or both. */
  @Post()
  @Access({ auth: ["staff"], permissions: ["packages:write"], reauth: true })
  @AdminAudit({ resource: "invitation_code", action: "create" })
  async create(@Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<InvitationCode> {
    const parsed = CreateCodeDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.codes.create(parsed.data, req.admin.adminId, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Deactivates the code (`{ "isActive": false }`); 404 when it does not exist. */
  @Patch(":id")
  @Access({ auth: ["staff"], permissions: ["packages:write"], reauth: true })
  @AdminAudit({ resource: "invitation_code", action: "deactivate" })
  async deactivate(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<InvitationCode> {
    const parsed = DeactivateCodeBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.codes.deactivate(id, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** The code's redemptions, newest first; 404 when the code does not exist. */
  @Get(":id/redemptions")
  @Access({ auth: ["staff"], permissions: ["packages:write"] })
  listRedemptions(@Param("id") id: string) {
    return this.codes.listRedemptions(id);
  }
}
