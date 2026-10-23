import { BadRequestException, Injectable } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { ProviderRepository } from "../../admin-providers/repository/provider.repository";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { DbTransaction } from "../../prisma/db-transaction";
import { REPORT_TIME_ZONE } from "../config/report-time-zone";
import { USAGE_GROUPINGS } from "../config/usage-groupings";
import type { ReportRangeQueryDto } from "../dto/report-range-query.dto";
import { ProviderReconciliationRepository } from "../repository/provider-reconciliation.repository";
import type { Audited } from "../types/audited";
import type { ReconciliationEntryView } from "../types/reconciliation-entry-view";
import type { ReconciliationReport } from "../types/reconciliation-report";
import type { ReconciliationWriteInput } from "../types/reconciliation-write-input";
import { previousDay } from "../utils/previous-day";
import { toDay } from "../utils/to-day";
import { toReconciliationEntryView } from "../utils/to-reconciliation-entry-view";
import { toReconciliationRow } from "../utils/to-reconciliation-row";
import { UsageAggregatesService } from "./usage-aggregates.service";

/**
 * Provider reconciliation (RNX-228): an admin enters a provider record's portal balance and top-up of a day; the report
 * sets each entered day's portal drop against our cost estimate for that provider and day and flags a drift above the
 * reconciliationDriftThresholdPercent setting. There is no automatic portal reader.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly entries: ProviderReconciliationRepository,
    private readonly providers: ProviderRepository,
    private readonly aggregates: UsageAggregatesService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Stores the provider's balance of the day, replacing an earlier entry of that day; 400 for an unknown provider record. */
  async record({ body, adminId }: ReconciliationWriteInput, tx: DbTransaction): Promise<Audited<ReconciliationEntryView>> {
    if (!(await this.providers.findLiveById(body.providerId, tx))) throw new BadRequestException("Unknown provider record");
    const before = await this.entries.findOne(body.providerId, body.day, tx);
    const entry = await this.entries.upsert(
      { providerId: body.providerId, day: body.day, portalBalanceUsd: new Decimal(body.portalBalanceUsd), topUpUsd: new Decimal(body.topUpUsd), adminId },
      tx,
    );
    const result = toReconciliationEntryView(entry);
    const none = { providerId: body.providerId, day: body.day, portalBalanceUsd: null, topUpUsd: null, enteredByAdminId: null };
    return { result, change: { before: before ? toReconciliationEntryView(before) : none, after: result } };
  }

  /** Every entered provider day from `from` to `to`, with its portal drop, our estimate and its flag. */
  async report({ from, to }: ReportRangeQueryDto): Promise<ReconciliationReport> {
    const thresholdPercent = await this.settings.getSetting("reconciliationDriftThresholdPercent");
    const stored = await this.entries.findBetween(previousDay(from), to);
    const estimates = await this.aggregates.sumUsage(from, to, USAGE_GROUPINGS.reconciliation);
    const keyOf = (providerId: string | null | undefined, day: string): string => `${providerId}|${day}`;
    const byKey = new Map(stored.map((entry) => [keyOf(entry.providerId, toDay(entry.day)), entry]));
    const estimateByKey = new Map(estimates.map((row) => [keyOf(row.providerId, row.day), row]));
    const rows = stored
      .filter((entry) => toDay(entry.day) >= from)
      .map((entry) =>
        toReconciliationRow({
          entry,
          previous: byKey.get(keyOf(entry.providerId, previousDay(toDay(entry.day)))),
          estimate: estimateByKey.get(keyOf(entry.providerId, toDay(entry.day))),
          thresholdPercent,
        }),
      );
    return { from, to, timeZone: REPORT_TIME_ZONE, driftThresholdPercent: thresholdPercent, rows };
  }
}
