import { Injectable, Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";
import { enqueueCreditWarningEmail } from "../../email/repository/enqueue-credit-warning-email";
import type { CreditWarningEmailPayload } from "../../email/types/credit-warning-email-payload";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { TransactionService } from "../../prisma/transaction.service";
import { ReminderRepository } from "../../reminder/repository/reminder.repository";
import { CREDIT_METER_SETTING_NAMES } from "../config/credit-meter-setting-names";
import { CREDIT_WARNING_CHECK } from "../config/credit-warning-check";
import { MS_PER_DAY } from "../config/ms-per-day";
import { RED_STATE_REMINDER_LIMIT } from "../config/red-state-reminder-limit";
import { RUN_OUT_PROJECTION } from "../config/run-out-projection";
import { CreditWarningRepository } from "../repository/credit-warning.repository";
import type { CompleteCreditMeterSettings } from "../types/complete-credit-meter-settings";
import type { CreditWarningAccountCheck } from "../types/credit-warning-account-check";
import type { CreditWarningCandidate } from "../types/credit-warning-candidate";
import type { CreditWarningToQueue } from "../types/credit-warning-to-queue";
import type { TimeWindow } from "../types/time-window";
import { dueReminderWindow } from "../utils/due-reminder-window";
import { evaluateCreditMeter } from "../utils/evaluate-credit-meter";
import { pickWarningsToSend } from "../utils/pick-warnings-to-send";
import { resolveProfileTimeZone } from "../utils/resolve-profile-time-zone";

/**
 * RNX-329: the run-out warning check. For each user-owned paid account with a purchase, whatever its balance (D387), it
 * computes the credit meter's level and floor flag (RNX-30-A, `evaluateCreditMeter`) from its balance, holds ignored
 * (D387), and, for each warning (amber, red, floor) reached and not yet sent in the account's purchase cycle, records it
 * and queues one mail to the owner, in one transaction.
 * Safe on several API containers at once: the record's unique key lets one insert win and only the winner queues the
 * mail. Bounded (D332): no model call, no credit hold, no provider; six setting reads, then three queries per page of
 * CREDIT_WARNING_CHECK.pageSize accounts, then per warning queued one transaction (and, for red, one reminder list).
 * Runs outside every request. Any of the six meter settings not set: the whole check is skipped and the missing ones
 * are named in the log.
 */
@Injectable()
export class CreditWarningService {
  private readonly logger = new Logger(CreditWarningService.name);

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly warnings: CreditWarningRepository,
    private readonly ledger: CreditLedgerEntryRepository,
    private readonly reminders: ReminderRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Runs the check over every account to check, page by page; returns how many warning mails it queued. */
  async runCheck(): Promise<number> {
    const now = new Date();
    const settings = await this.readSettings();
    if (!settings) return 0;
    let queued = 0;
    let afterAccountId: string | null = null;
    for (;;) {
      const page: CreditWarningCandidate[] = await this.warnings.findAccountsToCheck(afterAccountId, CREDIT_WARNING_CHECK.pageSize);
      queued += await this.checkPage(page, now, settings);
      if (page.length < CREDIT_WARNING_CHECK.pageSize) return queued;
      afterAccountId = page[page.length - 1].accountId;
    }
  }

  /** The six meter settings, or null (logged with the names of the missing ones) when any is not set. */
  private async readSettings(): Promise<CompleteCreditMeterSettings | null> {
    const values = await Promise.all(CREDIT_METER_SETTING_NAMES.map((name) => this.settings.getSetting(name)));
    const missing = CREDIT_METER_SETTING_NAMES.filter((_name, i) => values[i] === null);
    if (missing.length > 0) {
      this.logger.warn(`Run-out warning check skipped: platform settings not set: ${missing.join(", ")}`);
      return null;
    }
    return Object.fromEntries(CREDIT_METER_SETTING_NAMES.map((name, i) => [name, values[i]])) as CompleteCreditMeterSettings;
  }

  /** Checks one page: the page's usage and due reminder counts in one query each, then each account. */
  private async checkPage(page: readonly CreditWarningCandidate[], now: Date, settings: CompleteCreditMeterSettings): Promise<number> {
    const since = new Date(now.getTime() - RUN_OUT_PROJECTION.windowDays * MS_PER_DAY);
    const accounts = page.map((candidate) => ({ accountId: candidate.accountId, timeZone: resolveProfileTimeZone(candidate.timeZone) }));
    const usage = await this.ledger.summarizeUsageSinceByAccount(accounts, since);
    // Never null here: runOutAmberDays is set (readSettings).
    const window = dueReminderWindow(now, settings.runOutAmberDays) as TimeWindow;
    const dueCounts = await this.reminders.countActiveRemindersBetweenByUser(page.map((candidate) => candidate.userId), window.from, window.to);
    let queued = 0;
    for (const candidate of page) {
      queued += await this.checkAccount({
        candidate,
        now,
        settings,
        usage: usage.get(candidate.accountId) ?? { spent: new Decimal(0), usageDays: 0 },
        dueReminderCount: dueCounts.get(candidate.userId) ?? 0,
      });
    }
    return queued;
  }

  /** Queues the account's warnings reached and not yet sent in its cycle; returns how many it queued. */
  private async checkAccount(check: CreditWarningAccountCheck): Promise<number> {
    const { candidate, now } = check;
    const timeZone = resolveProfileTimeZone(candidate.timeZone);
    // D387: the level and the floor are judged on the balance, holds ignored (the banner keeps "available").
    const paidAvailable = new Decimal(candidate.paidBalance);
    const evaluation = evaluateCreditMeter({ now, paidAvailable, usage: check.usage, timeZone, dueReminderCount: check.dueReminderCount, settings: check.settings });
    const levels = pickWarningsToSend({ level: evaluation.level, belowFloor: evaluation.belowFloor, recorded: candidate.recordedLevels });
    let queued = 0;
    for (const level of levels) queued += (await this.queueWarning({ candidate, level, evaluation, timeZone, now })) ? 1 : 0;
    return queued;
  }

  /**
   * Records the warning and queues its mail to the owner in one transaction, the mail only when this call's insert created
   * the record (another container's run, or an earlier one, may have). True when the mail was queued.
   */
  private async queueWarning(warning: CreditWarningToQueue): Promise<boolean> {
    const { candidate, level, evaluation } = warning;
    const payload: CreditWarningEmailPayload = {
      level,
      paidBalance: candidate.paidBalance,
      runOutLabel: evaluation.projection.status === "date" ? evaluation.projection.runOutLabel : null,
      timeZone: warning.timeZone,
      reminders: level === "red" && evaluation.runOutAt ? await this.listRunsBefore(candidate.userId, warning.now, evaluation.runOutAt) : [],
    };
    return this.transactions.run(async (tx) => {
      const isRecorded = await this.warnings.insertWarning({ accountId: candidate.accountId, level, cycleStartedAt: candidate.cycleStartedAt }, tx);
      if (!isRecorded) return false;
      await enqueueCreditWarningEmail(tx, { recipientEmail: candidate.ownerEmail, payload });
      return true;
    });
  }

  /** The red mail's list: the owner's active reminders due before the run-out, the soonest RED_STATE_REMINDER_LIMIT (D360). */
  private async listRunsBefore(userId: string, now: Date, runOutAt: Date): Promise<CreditWarningEmailPayload["reminders"]> {
    const runs = await this.reminders.listActiveUserRemindersBetween(userId, now, runOutAt, RED_STATE_REMINDER_LIMIT);
    return runs.map((run) => ({ description: run.description, nextRunAt: run.nextRunAt.toISOString() }));
  }
}
