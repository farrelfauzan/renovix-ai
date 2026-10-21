import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AdminRequest } from "../../admin-auth/types/admin-request";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { CreateProviderDto } from "../dto/create-provider.dto";
import { TestProviderDto } from "../dto/test-provider.dto";
import { UpdateProviderDto } from "../dto/update-provider.dto";
import { AdminProvidersService } from "../service/admin-providers.service";
import type { ProviderTestOutcome } from "../types/provider-test-outcome";
import type { ProviderView } from "../types/provider-view";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * Provider records (RX-177, D148, D149), API only (the screen is RX-102). Under /api/v1/admin/providers.
 * Reads need `providers:read`, writes `providers:write`. Every write but the test is audited through the
 * hook (`@AdminAudit`, handler writes on `req.audit.tx`); the test writes its own audit row, because its
 * provider call must not run inside a transaction. No response ever contains the key.
 */
@Controller("admin/providers")
export class AdminProvidersController {
  constructor(private readonly providers: AdminProvidersService) {}

  /** Every live provider: type, name, baseUrl, status, hasApiKey, apiKeyHint, last test and modelCount. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["providers:read"] })
  list(): Promise<ProviderView[]> {
    return this.providers.list();
  }

  /** One live provider, same fields. */
  @Get(":id")
  @Access({ auth: ["staff"], permissions: ["providers:read"] })
  get(@Param("id") id: string): Promise<ProviderView> {
    return this.providers.get(id);
  }

  /** Creates an inactive provider; type, name, baseUrl and apiKey are required. */
  @Post()
  @Access({ auth: ["staff"], permissions: ["providers:write"] })
  @AdminAudit({ resource: "provider", action: "create" })
  async create(@Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<ProviderView> {
    const parsed = CreateProviderDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.providers.create(req.admin.adminId, parsed.data, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Changes name, baseUrl, apiKey (rotation) or sets status inactive; a type change is refused with 400. */
  @Patch(":id")
  @Access({ auth: ["staff"], permissions: ["providers:write"] })
  @AdminAudit({ resource: "provider", action: "update" })
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<ProviderView> {
    const parsed = UpdateProviderDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.providers.update(req.admin.adminId, id, parsed.data, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Sends one minimal request with `slug`; 200 with `isSuccessful` and a stored reason, or 400/404/409 (bad body, unknown provider, changed during the test or unreadable stored key). */
  @Post(":id/test")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["providers:write"] })
  @AdminAudit({ exempt: true, reason: "the provider call must run outside a transaction; the handler writes its own audit row" })
  async test(@Param("id") id: string, @Body() body: unknown, @Req() req: AdminRequest): Promise<ProviderTestOutcome> {
    const parsed = TestProviderDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    return this.providers.test(req.admin.adminId, id, parsed.data.slug, req.id);
  }

  /** Activates the provider; 409 unless a test has succeeded since the last key or base URL change. */
  @Post(":id/activate")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["providers:write"] })
  @AdminAudit({ resource: "provider", action: "activate" })
  async activate(@Param("id") id: string, @Req() req: AuditedAdminRequest): Promise<ProviderView> {
    const { result, change } = await this.providers.activate(req.admin.adminId, id, req.audit.tx);
    req.audit.record(change);
    return result;
  }

  /** Soft-deletes the provider; 409 while it has active models. */
  @Delete(":id")
  @HttpCode(204)
  @Access({ auth: ["staff"], permissions: ["providers:write"] })
  @AdminAudit({ resource: "provider", action: "delete" })
  async remove(@Param("id") id: string, @Req() req: AuditedAdminRequest): Promise<void> {
    const { change } = await this.providers.remove(req.admin.adminId, id, req.audit.tx);
    req.audit.record(change);
  }
}
