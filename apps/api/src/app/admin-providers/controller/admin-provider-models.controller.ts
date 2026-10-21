import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { CreateProviderModelDto } from "../dto/create-provider-model.dto";
import { UpdateProviderModelDto } from "../dto/update-provider-model.dto";
import { AdminProviderModelsService } from "../service/admin-provider-models.service";
import type { ProviderModelView } from "../types/provider-model-view";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * The models of a provider record (RX-177, D149), nested as the back office shows them. Reads need
 * `models:read`, writes `models:write`; writes are audited through the hook. No delete: a model is deactivated.
 */
@Controller("admin/providers/:providerId/models")
export class AdminProviderModelsController {
  constructor(private readonly models: AdminProviderModelsService) {}

  /** Every model of the provider, active or not. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["models:read"] })
  list(@Param("providerId") providerId: string): Promise<ProviderModelView[]> {
    return this.models.list(providerId);
  }

  /** Creates a model on the provider; `active` is required, the slug unique across all providers. */
  @Post()
  @Access({ auth: ["staff"], permissions: ["models:write"] })
  @AdminAudit({ resource: "ai_model", action: "create" })
  async create(@Param("providerId") providerId: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<ProviderModelView> {
    const parsed = CreateProviderModelDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.models.create(providerId, parsed.data, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Changes a model of the provider; the slug cannot change (400), a model of another provider is a 404. */
  @Patch(":modelId")
  @Access({ auth: ["staff"], permissions: ["models:write"] })
  @AdminAudit({ resource: "ai_model", action: "update" })
  async update(
    @Param("providerId") providerId: string,
    @Param("modelId") modelId: string,
    @Body() body: unknown,
    @Req() req: AuditedAdminRequest,
  ): Promise<ProviderModelView> {
    const parsed = UpdateProviderModelDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.models.update(providerId, modelId, parsed.data, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
