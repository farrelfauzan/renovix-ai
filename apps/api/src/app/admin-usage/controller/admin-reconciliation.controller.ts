import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { ReconciliationEntryBodyDto } from "../dto/reconciliation-entry-body.dto";
import { ReportRangeQueryDto } from "../dto/report-range-query.dto";
import { ReconciliationService } from "../service/reconciliation.service";
import type { ReconciliationEntryView } from "../types/reconciliation-entry-view";
import type { ReconciliationReport } from "../types/reconciliation-report";

/**
 * Provider reconciliation (RNX-228), API only. Under /api/v1/admin/reconciliation. Entering a portal balance needs
 * `reconciliation:write` and is audited; the report (our cost against the portal) needs `profit:read`.
 */
@Controller("admin/reconciliation")
export class AdminReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  /** The entered provider days from `from` to `to` (YYYY-MM-DD), each with its portal drop, our estimate and its flag. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["profit:read"] })
  report(@Query() query: unknown): Promise<ReconciliationReport> {
    const parsed = ReportRangeQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.reconciliation.report(parsed.data);
  }

  /** Stores a provider record's portal balance and top-up of one day; 400 without a known provider record. */
  @Post("entries")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["reconciliation:write"] })
  @AdminAudit({ resource: "provider_reconciliation", action: "record" })
  async record(@Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<ReconciliationEntryView> {
    const parsed = ReconciliationEntryBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.reconciliation.record({ body: parsed.data, adminId: req.admin.adminId }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
