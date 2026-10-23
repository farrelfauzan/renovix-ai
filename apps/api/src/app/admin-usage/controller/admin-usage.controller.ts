import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { AdminAudit } from "../../admin-auth/decorator/admin-audit.decorator";
import type { AuditedAdminRequest } from "../../admin-auth/types/audited-admin-request";
import { EmailRevealBodyDto } from "../dto/email-reveal-body.dto";
import { ReportRangeQueryDto } from "../dto/report-range-query.dto";
import { UsageReportService } from "../service/usage-report.service";
import type { EmailRevealView } from "../types/email-reveal-view";
import type { ProfitReport } from "../types/profit-report";
import type { UsageReport } from "../types/usage-report";

/**
 * Usage, cost and profit reports (RNX-228), API only (the screens are RNX-163). Under /api/v1/admin/usage. Token
 * counts need `usage:read`; cost, revenue, profit and margin need `profit:read`. Users are shown by id with the email
 * masked; revealing one needs `users:read_pii` too and writes an audit row with the reason.
 */
@Controller("admin/usage")
export class AdminUsageController {
  constructor(private readonly reports: UsageReportService) {}

  /** Token counts and calls per day, provider record, model, tier and workspace or user, `from` to `to` (YYYY-MM-DD). */
  @Get("daily")
  @Access({ auth: ["staff"], permissions: ["usage:read"] })
  daily(@Query() query: unknown): Promise<UsageReport> {
    const parsed = ReportRangeQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.reports.usageReport(parsed.data);
  }

  /** Cost, revenue, profit and net margin per day, provider record, model, tier, wallet and package, with credits sold. */
  @Get("profit")
  @Access({ auth: ["staff"], permissions: ["profit:read"] })
  profit(@Query() query: unknown): Promise<ProfitReport> {
    const parsed = ReportRangeQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.reports.profitReport(parsed.data);
  }

  /** Reveals a user's email (`{ reason }`); 404 for an unknown user. Audited through the hook, with the reason. */
  @Post("users/:userId/email")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["usage:read", "users:read_pii"] })
  @AdminAudit({ resource: "user_pii", action: "reveal" })
  async revealEmail(@Param("userId") userId: string, @Body() body: unknown, @Req() req: AuditedAdminRequest): Promise<EmailRevealView> {
    const parsed = EmailRevealBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { result, change } = await this.reports.revealEmail({ userId, body: parsed.data }, req.audit.tx);
    req.audit.record(change);
    return result;
  }
}
