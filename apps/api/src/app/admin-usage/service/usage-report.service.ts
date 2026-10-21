import { Injectable, NotFoundException } from "@nestjs/common";
import { UserRepository } from "../../auth/repository/user.repository";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { DbTransaction } from "../../prisma/db-transaction";
import { CREDITS_SOLD_LABEL } from "../config/credits-sold-label";
import { PPN_RATE } from "../config/ppn-rate";
import { REPORT_TIME_ZONE } from "../config/report-time-zone";
import { USAGE_GROUPINGS } from "../config/usage-groupings";
import type { ReportRangeQueryDto } from "../dto/report-range-query.dto";
import type { Audited } from "../types/audited";
import type { EmailRevealInput } from "../types/email-reveal-input";
import type { EmailRevealView } from "../types/email-reveal-view";
import type { ProfitReport } from "../types/profit-report";
import type { UsageReport } from "../types/usage-report";
import { toAmount } from "../utils/to-amount";
import { toCreditSalesView } from "../utils/to-credit-sales-view";
import { toProfitReportRow } from "../utils/to-profit-report-row";
import { toProfitTotals } from "../utils/to-profit-totals";
import { toUsageReportRow } from "../utils/to-usage-report-row";
import { UsageAggregatesService } from "./usage-aggregates.service";

/**
 * The usage and profit reports of the back office (RNX-228), read from the daily aggregates. The usage report has
 * token counts and calls only (usage:read); the profit report has cost, revenue, profit and net margin (profit:read).
 * A user is shown by id with the email masked; revealing it is a separate, audited request (users:read_pii).
 */
@Injectable()
export class UsageReportService {
  constructor(
    private readonly aggregates: UsageAggregatesService,
    private readonly settings: PlatformSettingsService,
    private readonly users: UserRepository,
  ) {}

  /** Token counts and calls per day, provider record, model, tier and workspace or user. */
  async usageReport({ from, to }: ReportRangeQueryDto): Promise<UsageReport> {
    const rows = await this.aggregates.sumUsage(from, to, USAGE_GROUPINGS.usage);
    const userIds = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
    const emails = new Map((await this.users.findEmails(userIds)).map((user) => [user.id, user.email]));
    return { from, to, timeZone: REPORT_TIME_ZONE, rows: rows.map((row) => toUsageReportRow({ row, emails })) };
  }

  /** Cost, revenue, profit and net margin per day, provider record, model, tier, wallet and package, with totals and credits sold. */
  async profitReport({ from, to }: ReportRangeQueryDto): Promise<ProfitReport> {
    const feePercent = await this.settings.getSetting("paymentGatewayFeePercent");
    const rows = await this.aggregates.sumUsage(from, to, USAGE_GROUPINGS.profit);
    const sales = await this.aggregates.sumCreditSales(from, to);
    return {
      from,
      to,
      timeZone: REPORT_TIME_ZONE,
      ppnRate: toAmount(PPN_RATE),
      paymentGatewayFeePercent: feePercent,
      rows: rows.map((row) => toProfitReportRow(row, feePercent)),
      totals: toProfitTotals(rows, feePercent),
      creditsSold: { label: CREDITS_SOLD_LABEL, rows: sales.map(toCreditSalesView) },
    };
  }

  /** A user's email, unmasked; 404 for an unknown user. The audit row (with the reason) is written by the route's hook. */
  async revealEmail({ userId, body }: EmailRevealInput, tx: DbTransaction): Promise<Audited<EmailRevealView>> {
    const user = await this.users.findPortalUser(userId, tx);
    if (!user) throw new NotFoundException("User not found");
    return {
      result: { userId: user.id, email: user.email },
      change: { before: { userId: user.id, revealed: false }, after: { userId: user.id, revealed: true }, reason: body.reason },
    };
  }
}
