import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { SaveSettingBodyDto } from "../dto/save-setting-body.dto";
import { AdminSettingsService } from "../service/admin-settings.service";
import type { SettingView } from "../types/setting-view";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * Typed platform settings (RNX-226), API only (the screens are RNX-98). Under /api/v1/admin/settings. Reads need
 * `settings:read`, writes `settings:write`. Every write is audited through the hook (`req.audit.tx`).
 */
@Controller("admin/settings")
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  /** Every setting of the registry with its value, null when not set. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["settings:read"] })
  list(): Promise<SettingView[]> {
    return this.settings.list();
  }

  /** Writes one setting (`{ value, reason }`); 400 for an unknown name or a value its schema refuses, and nothing changes. */
  @Put(":name")
  @Access({ auth: ["staff"], permissions: ["settings:write"] })
  @AdminAudit({ resource: "platform_setting", action: "update" })
  async save(@Param("name") name: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<SettingView> {
    const parsed = SaveSettingBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.settings.save({ id: name, body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
