import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { EnterpriseBundle, EnterpriseBundleVersion } from "@generated/prisma/client.js";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { EnterpriseBundleVersionBodyDto } from "../dto/enterprise-bundle-version-body.dto";
import { UpdateActiveBodyDto } from "../dto/update-active-body.dto";
import { AdminEnterpriseBundlesService } from "../service/admin-enterprise-bundles.service";

/**
 * Enterprise bundles (RNX-226), API only (the screens are RNX-98). Under /api/v1/admin/enterprise-bundles. Reads need
 * `packages:read`, writes `packages:write`; a new version also needs a recent re-authentication (D250). Every write is
 * audited through the hook (`req.audit.tx`). Amounts may be null while D1 is open; every change is a new version with a
 * reason and an effective date.
 */
@Controller("admin/enterprise-bundles")
export class AdminEnterpriseBundlesController {
  constructor(private readonly bundles: AdminEnterpriseBundlesService) {}

  /** Every Enterprise bundle by name, with all its versions, newest first. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["packages:read"] })
  list() {
    return this.bundles.list();
  }

  /** One Enterprise bundle with all its versions; 404 when it does not exist. */
  @Get(":id")
  @Access({ auth: ["staff"], permissions: ["packages:read"] })
  get(@Param("id") id: string) {
    return this.bundles.get(id);
  }

  /** Turns the bundle's active flag on or off, with a reason. */
  @Patch(":id")
  @Access({ auth: ["staff"], permissions: ["packages:write"] })
  @AdminAudit({ resource: "enterprise_bundle", action: "update" })
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<EnterpriseBundle> {
    const parsed = UpdateActiveBodyDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { result, change } = await this.bundles.update({ id, body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Creates the next version (pool credits, monthly price) with a reason and an effective date. */
  @Post(":id/versions")
  @Access({ auth: ["staff"], permissions: ["packages:write"], reauth: true })
  @AdminAudit({ resource: "enterprise_bundle", action: "create_version" })
  async createVersion(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<EnterpriseBundleVersion> {
    const parsed = EnterpriseBundleVersionBodyDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { result, change } = await this.bundles.createVersion({ id, body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
