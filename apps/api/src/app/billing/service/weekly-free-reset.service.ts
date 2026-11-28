import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { UserRepository } from "../../auth/repository/user.repository";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { CreditAccountRepository } from "../repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../repository/credit-ledger-entry.repository";
import type { WeeklyResetPlan } from "../types/weekly-reset-plan";
import { toJakartaIsoWeek } from "../utils/to-jakarta-iso-week";
import { CreditLedgerService } from "./credit-ledger.service";

/** The platform setting that holds the weekly allowance (D5). It has no default in code. */
const ALLOWANCE_SETTING = "weeklyFreeAllowanceCredits";
/** Users read per keyset page; each of their wallets is then reset in its own short transaction. */
const WEEKLY_RESET_BATCH_SIZE = 100;

/**
 * RNX-321: the weekly reset of the free allowance (docs/credits.md section 6, decision 5a). Every active user's
 * weekly_free wallet's balance is set to the allowance, with no carry-over, or to what its open holds hold when that is
 * more (D467), by one `weekly_reset` entry keyed by the Asia/Jakarta ISO week. Holds are untouched, so available credits
 * are the allowance minus the holds and never above the allowance. Paid wallets are never read or written.
 */
@Injectable()
export class WeeklyFreeResetService {
  private readonly logger = new Logger(WeeklyFreeResetService.name);

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly users: UserRepository,
    private readonly transactions: TransactionService,
    private readonly accounts: CreditAccountRepository,
    private readonly entries: CreditLedgerEntryRepository,
    private readonly ledger: CreditLedgerService,
  ) {}

  /**
   * Resets every active user's weekly_free wallet for the ISO week (Asia/Jakarta) that contains `now`, and returns how
   * many entries this call wrote. A wallet already reset this week, by an earlier run or by another instance at the same
   * time, is left as it is. When the allowance setting is not set, nothing is read or written and a log line names it;
   * an invalid stored value fails the run (PlatformSettingsService.getSetting) before any wallet is touched.
   */
  async resetWeeklyFreeWallets(now: Date): Promise<number> {
    const allowance = await this.settings.getSetting(ALLOWANCE_SETTING);
    if (allowance === null) {
      this.logger.warn(`Weekly free reset skipped: the platform setting ${ALLOWANCE_SETTING} is not set`);
      return 0;
    }
    const plan = { allowance: new Decimal(allowance), idempotencyKey: `weekly_reset:${toJakartaIsoWeek(now)}` };
    return this.resetEveryActiveUser(plan);
  }

  /** Pages through the active users by id (keyset) and resets each one's wallet; returns the entries written. */
  private async resetEveryActiveUser(plan: WeeklyResetPlan): Promise<number> {
    let written = 0;
    let afterId: string | undefined;
    for (;;) {
      const userIds = await this.users.findActiveUserIdsAfter(afterId, WEEKLY_RESET_BATCH_SIZE);
      for (const userId of userIds) if (await this.resetWallet(userId, plan)) written += 1;
      if (userIds.length < WEEKLY_RESET_BATCH_SIZE) return written;
      afterId = userIds[userIds.length - 1];
    }
  }

  /**
   * Resets one user's wallet in its own transaction; true when this call wrote the entry. A 409 means a concurrent run
   * wrote this week's entry first (the unique (account, idempotency key) or seq refused this one, and its transaction
   * rolled back): that wallet is skipped and the run goes on.
   */
  private async resetWallet(userId: string, plan: WeeklyResetPlan): Promise<boolean> {
    try {
      return await this.transactions.run((tx) => this.resetLockedWallet(userId, plan, tx));
    } catch (err) {
      if (err instanceof ConflictException) return false;
      throw err;
    }
  }

  /**
   * Inside the wallet's transaction: locks the weekly_free row (created first when missing, race-safe), skips it when
   * this week's entry is already there, else appends amount = max(allowance, held) - balance through the ledger's own
   * append (same transaction, same lock), so balanceAfter = max(allowance, held) (docs/credits.md section 6).
   */
  private async resetLockedWallet(userId: string, plan: WeeklyResetPlan, tx: DbTransaction): Promise<boolean> {
    const owner = { userId };
    const account = await this.accounts.lockOrCreateAccount(owner, "weekly_free", tx);
    if (await this.entries.findEntryByIdempotencyKey(account.id, plan.idempotencyKey, tx)) return false;
    const amount = Decimal.max(plan.allowance, account.held).minus(account.balance);
    await this.ledger.appendEntry(
      { owner, wallet: "weekly_free", type: "weekly_reset", amount, memberUserId: userId, idempotencyKey: plan.idempotencyKey },
      tx,
    );
    return true;
  }
}
