import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Package, PackageVersion } from "@generated/prisma/client.js";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { PackageVersionBodyDto } from "../dto/package-version-body.dto";
import { UpdatePackageBodyDto } from "../dto/update-package-body.dto";
import { AdminPackagesService } from "../service/admin-packages.service";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * Packages (RNX-226, D46), API only (the screens are RNX-98). Under /api/v1/admin/packages. Reads need `packages:read`,
 * writes `packages:write`; a new version (a price change) also needs a recent re-authentication (D250). Every write is
 * audited through the hook (`@AdminAudit`, the handler writes on `req.audit.tx`). Prices are in US dollar cents; every
 * price or limit change is a new version with a reason and an effective date.
 */
@Controller("admin/packages")
export class AdminPackagesController {
  constructor(private readonly packages: AdminPackagesService) {}

  /** Every package in display order, with all its versions, newest first. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["packages:read"] })
  list() {
    return this.packages.list();
  }

  /** One package with all its versions; 404 when it does not exist. */
  @Get(":id")
  @Access({ auth: ["staff"], permissions: ["packages:read"] })
  get(@Param("id") id: string) {
    return this.packages.get(id);
  }

  /** Changes the display order or the active and visible flags, with a reason. */
  @Patch(":id")
  @Access({ auth: ["staff"], permissions: ["packages:write"] })
  @AdminAudit({ resource: "package", action: "update" })
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<Package> {
    const parsed = UpdatePackageBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.packages.update({ id, body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Creates the next version (price, credits, limits, allowed tiers) with a reason and an effective date. */
  @Post(":id/versions")
  @Access({ auth: ["staff"], permissions: ["packages:write"], reauth: true })
  @AdminAudit({ resource: "package", action: "create_version" })
  async createVersion(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<PackageVersion> {
    const parsed = PackageVersionBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.packages.createVersion({ id, body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
