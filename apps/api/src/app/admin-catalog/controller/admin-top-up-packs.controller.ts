import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { TopUpPack, TopUpPackVersion } from "@generated/prisma/client.js";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { TopUpPackVersionBodyDto } from "../dto/top-up-pack-version-body.dto";
import { UpdateActiveBodyDto } from "../dto/update-active-body.dto";
import { AdminTopUpPacksService } from "../service/admin-top-up-packs.service";

/**
 * Top-up packs (RNX-226), API only (the screens are RNX-98). Under /api/v1/admin/top-up-packs. Reads need
 * `packages:read`, writes `packages:write`; a new version also needs a recent re-authentication (D250). Every write is
 * audited through the hook (`req.audit.tx`). Prices are in US dollar cents; every price change is a new version with a
 * reason and an effective date.
 */
@Controller("admin/top-up-packs")
export class AdminTopUpPacksController {
  constructor(private readonly packs: AdminTopUpPacksService) {}

  /** Every top-up pack by name, with all its versions, newest first. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["packages:read"] })
  list() {
    return this.packs.list();
  }

  /** One top-up pack with all its versions; 404 when it does not exist. */
  @Get(":id")
  @Access({ auth: ["staff"], permissions: ["packages:read"] })
  get(@Param("id") id: string) {
    return this.packs.get(id);
  }

  /** Turns the pack's active flag on or off, with a reason. */
  @Patch(":id")
  @Access({ auth: ["staff"], permissions: ["packages:write"] })
  @AdminAudit({ resource: "top_up_pack", action: "update" })
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<TopUpPack> {
    const parsed = UpdateActiveBodyDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { result, change } = await this.packs.update({ id, body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Creates the next version (price, credits) with a reason and an effective date. */
  @Post(":id/versions")
  @Access({ auth: ["staff"], permissions: ["packages:write"], reauth: true })
  @AdminAudit({ resource: "top_up_pack", action: "create_version" })
  async createVersion(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<TopUpPackVersion> {
    const parsed = TopUpPackVersionBodyDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { result, change } = await this.packs.createVersion({ id, body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
