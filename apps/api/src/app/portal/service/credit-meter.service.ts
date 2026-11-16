import { Injectable, Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import type { CreditAccount } from "@generated/prisma/client.js";
import { UserRepository } from "../../auth/repository/user.repository";
import { isIanaTimeZone } from "../../auth/utils/is-iana-time-zone";
import { CreditAccountRepository } from "../../billing/repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";
import type { PaidUsageSummary } from "../../billing/types/paid-usage-summary";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ReminderRepository } from "../../reminder/repository/reminder.repository";
import { MS_PER_DAY } from "../config/ms-per-day";
import { RUN_OUT_PROJECTION } from "../config/run-out-projection";
import type { CreditMeter } from "../types/credit-meter";
import type { CreditMeterReminder } from "../types/credit-meter-reminder";
import type { CreditMeterSettings } from "../types/credit-meter-settings";
import type { RunOutProjection } from "../types/run-out-projection";
import { availableCredits } from "../utils/available-credits";
import { creditMeterLevel } from "../utils/credit-meter-level";
import { dueReminderWindow } from "../utils/due-reminder-window";
import { isBelowFloor } from "../utils/is-below-floor";
import { projectRunOut } from "../utils/project-run-out";

/** The platform settings the credit meter reads, in the order a missing one is named in the log. */
const METER_SETTING_NAMES = [
  "projectionMinSpendCredits",
  "projectionMaxDays",
  "runOutAmberDays",
  "runOutRedDays",
  "runOutFloorCredits",
  "perRunCreditCap",
] as const satisfies ReadonlyArray<keyof CreditMeterSettings>;

/**
 * RNX-30-A: the signed-in user's credit meter (D45, D47): both wallets' available credits, the paid wallet's run-out
 * projection, the warning level, the floor flag and, in the red state, the reminders due before the run-out. Read-only
 * (D332): a fixed number of bounded queries (six settings, two accounts, the timezone, one usage aggregate, at most one
 * reminder count and one reminder list), no write, no model call. A threshold that is not set skips its check and is named once in the log.
 */
@Injectable()
export class CreditMeterService {
  private readonly logger = new Logger(CreditMeterService.name);

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly accounts: CreditAccountRepository,
    private readonly ledger: CreditLedgerEntryRepository,
    private readonly users: UserRepository,
    private readonly reminders: ReminderRepository,
  ) {}

  /** The meter of this user; the caller passes the session's user id, never a requested one. */
  async getForUser(userId: string): Promise<CreditMeter> {
    const now = new Date();
    const settings = await this.readSettings();
    const paid = await this.accounts.findAccount({ userId }, "paid");
    const weeklyFree = await this.accounts.findAccount({ userId }, "weekly_free");
    const paidAvailable = availableCredits(paid);
    const projection = await this.projectPaidRunOut(userId, paid, now, settings);
    const runOutAt = projection.status === "date" ? projection.runOutAt : null;
    const level = creditMeterLevel({ now, runOutAt, amberDays: settings.runOutAmberDays, redDays: settings.runOutRedDays });
    const dueReminderCount = await this.countDueReminders(userId, now, settings);
    return {
      paidAvailable: paidAvailable.toString(),
      weeklyFreeAvailable: availableCredits(weeklyFree).toString(),
      projection,
      level,
      belowFloor: isBelowFloor({ paidAvailable, floorCredits: settings.runOutFloorCredits, perRunCreditCap: settings.perRunCreditCap, dueReminderCount }),
      dueReminders: level === "red" && runOutAt ? await this.listRemindersBefore(userId, now, runOutAt) : [],
    };
  }

  /** The six meter settings, each null when not set; the names of the missing ones are logged in one line. */
  private async readSettings(): Promise<CreditMeterSettings> {
    const values = await Promise.all(METER_SETTING_NAMES.map((name) => this.settings.getSetting(name)));
    const missing = METER_SETTING_NAMES.filter((_name, i) => values[i] === null);
    if (missing.length > 0) this.logger.warn(`Credit meter: platform settings not set, their checks are skipped: ${missing.join(", ")}`);
    return Object.fromEntries(METER_SETTING_NAMES.map((name, i) => [name, values[i]])) as CreditMeterSettings;
  }

  /** The paid wallet's run-out from its usage in the projection window, days counted in the profile timezone. */
  private async projectPaidRunOut(userId: string, paid: CreditAccount | null, now: Date, settings: CreditMeterSettings): Promise<RunOutProjection> {
    const stored = (await this.users.findTimezone(userId))?.timezone;
    // A stored zone the database or Intl would reject (not every write path validates it) falls back to the default.
    const timeZone = stored && isIanaTimeZone(stored) ? stored : RUN_OUT_PROJECTION.defaultTimeZone;
    const usage = await this.summarizePaidUsage(paid, now, timeZone);
    return projectRunOut({
      now,
      paidAvailable: availableCredits(paid),
      spentInWindow: usage.spent,
      usageDays: usage.usageDays,
      timeZone,
      minSpendCredits: settings.projectionMinSpendCredits,
      maxDays: settings.projectionMaxDays,
    });
  }

  /** The paid account's usage in the projection window; none without the account. */
  private summarizePaidUsage(paid: CreditAccount | null, now: Date, timeZone: string): Promise<PaidUsageSummary> {
    if (!paid) return Promise.resolve({ spent: new Decimal(0), usageDays: 0 });
    const since = new Date(now.getTime() - RUN_OUT_PROJECTION.windowDays * MS_PER_DAY);
    return this.ledger.summarizeUsageSince(paid.id, since, timeZone);
  }

  /** The due reminders for the floor check (`dueReminderWindow`); 0 when the window or perRunCreditCap is not set. */
  private async countDueReminders(userId: string, now: Date, settings: CreditMeterSettings): Promise<number> {
    const window = dueReminderWindow(now, settings.runOutAmberDays);
    if (!window || settings.perRunCreditCap === null) return 0;
    return this.reminders.countActiveUserRemindersBetween(userId, window.from, window.to);
  }

  /** The red state's list: the user's active reminders due from now until the run-out instant. */
  private listRemindersBefore(userId: string, now: Date, runOutAt: Date): Promise<CreditMeterReminder[]> {
    return this.reminders.listActiveUserRemindersBetween(userId, now, runOutAt);
  }
}
