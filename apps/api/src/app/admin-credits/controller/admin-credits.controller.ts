import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { CreditAdjustmentDto } from "../dto/credit-adjustment.dto";
import { CreditAdjustmentService } from "../service/credit-adjustment.service";
import type { CreditAdjustmentView } from "../types/credit-adjustment-view";

/**
 * Credit adjustments (RNX-227, the backend of RNX-99) under /api/v1/admin/credits. Needs `credits:adjust` and a
 * re-authentication within REAUTH_WINDOW_MINUTES; audited through the hook, so the ledger entry and its audit row
 * commit in one transaction. The back-office action id is the request id: the entry's reference and the audit
 * row's request id, whose row holds the reason.
 */
@Controller("admin/credits")
export class AdminCreditsController {
  constructor(private readonly adjustments: CreditAdjustmentService) {}

  /** Adds or removes credits on a user's or a company's paid wallet; 200 with the entry, also for a replay of the same key. */
  @Post("adjustments")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["credits:adjust"], reauth: true })
  @AdminAudit({ resource: "credit_account", action: "adjust" })
  async adjust(@Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<CreditAdjustmentView> {
    const parsed = CreditAdjustmentDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { result, change } = await this.adjustments.adjust({ adminId: req.admin.adminId, actionId: req.id, adjustment: parsed.data }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
