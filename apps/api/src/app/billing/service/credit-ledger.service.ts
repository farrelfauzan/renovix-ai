import { Injectable } from "@nestjs/common";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import { CreditAccountRepository } from "../repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../repository/credit-ledger-entry.repository";
import type { CreditEntryInput } from "../types/credit-entry-input";

/** Ledger amounts are whole micro-credits: at most 6 decimal places (docs/credits.md section 2.3). */
const MICRO_CREDIT_DECIMALS = 6;

/** Appends credit ledger entries (RX-20, docs/credits.md section 2). Reserve, settle and release are RX-22. */
@Injectable()
export class CreditLedgerService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly accounts: CreditAccountRepository,
    private readonly entries: CreditLedgerEntryRepository,
  ) {}

  /**
   * Appends one entry to the owner's wallet in one transaction, creating the account on first use: locks the account
   * row, returns the existing entry when the idempotency key is already on the account (a replay writes nothing, I8),
   * otherwise inserts the entry with seq = lastSeq + 1 and balanceAfter = balance + amount and moves the account to
   * them (I1, I2). Refuses with CreditsExhaustedException, writing nothing, when balanceAfter would be below the held
   * credits or below 0 (I5). Given `tx`, it joins that transaction.
   */
  async appendEntry(input: CreditEntryInput, tx?: DbTransaction): Promise<CreditLedgerEntry> {
    if (input.amount.decimalPlaces() > MICRO_CREDIT_DECIMALS) {
      throw new Error(`A ledger amount must be whole micro-credits, got ${input.amount.toString()}`);
    }
    return this.transactions.run((work) => this.appendToLockedAccount(input, work), undefined, tx);
  }

  /** The body of `appendEntry`, inside its transaction. */
  private async appendToLockedAccount(input: CreditEntryInput, tx: DbTransaction): Promise<CreditLedgerEntry> {
    const { owner, wallet, amount, ...fields } = input;
    const account = await this.accounts.lockOrCreateAccount(owner, wallet, tx);
    const replayed = await this.entries.findEntryByIdempotencyKey(account.id, input.idempotencyKey, tx);
    if (replayed) return replayed;
    const balanceAfter = account.balance.plus(amount);
    // held is never negative (CHECK), so this also refuses a balance below 0.
    if (balanceAfter.lessThan(account.held)) throw new CreditsExhaustedException();
    const seq = account.lastSeq + 1;
    const entry = await this.entries.createEntry({ ...fields, accountId: account.id, wallet, seq, amount, balanceAfter }, tx);
    await this.accounts.updateBalance(account.id, balanceAfter, seq, tx);
    return entry;
  }
}
