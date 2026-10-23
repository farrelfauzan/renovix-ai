import { Injectable } from "@nestjs/common";
import { ROLLUP_BATCH_DAYS } from "../config/rollup-batch-days";
import { UsageRollupRepository } from "../repository/usage-rollup.repository";
import type { CreditSalesRow } from "../types/credit-sales-row";
import type { UsageDaySplit } from "../types/usage-day-split";
import type { UsageGrouping } from "../types/usage-grouping";
import type { UsageSumRow } from "../types/usage-sum-row";
import { listDays } from "../utils/list-days";

/**
 * The daily usage, cost and revenue aggregates (RNX-228). Reads never scan the raw rows of a built day: a closed day is
 * built once into the rollups by `buildClosedDays` (the daily job), and only the days not built yet (today, or a day the
 * job has not reached) are computed live, with the same query.
 */
@Injectable()
export class UsageAggregatesService {
  constructor(private readonly rollups: UsageRollupRepository) {}

  /** The usage rows of `from` to `to` (YYYY-MM-DD, both included), summed by the grouping's columns. */
  async sumUsage(from: string, to: string, grouping: UsageGrouping): Promise<UsageSumRow[]> {
    const { builtDays, liveDays } = await this.splitDays(from, to);
    return this.rollups.sumUsage(builtDays, liveDays, grouping);
  }

  /** Credits sold per day and package from `from` to `to`. */
  async sumCreditSales(from: string, to: string): Promise<CreditSalesRow[]> {
    const { builtDays, liveDays } = await this.splitDays(from, to);
    return this.rollups.sumCreditSales(builtDays, liveDays);
  }

  /**
   * Builds the closed days not built yet, oldest first, at most ROLLUP_BATCH_DAYS per run. Safe on several instances:
   * each day is built under an advisory lock and only once. Returns the days this run built.
   */
  async buildClosedDays(): Promise<string[]> {
    const built: string[] = [];
    for (const day of await this.rollups.findUnbuiltClosedDays(ROLLUP_BATCH_DAYS)) {
      if (await this.rollups.buildDay(day)) built.push(day);
    }
    return built;
  }

  private async splitDays(from: string, to: string): Promise<UsageDaySplit> {
    const days = listDays(from, to);
    const builtDays = await this.rollups.findBuiltDays(days);
    return { builtDays, liveDays: days.filter((day) => !builtDays.includes(day)) };
  }
}
