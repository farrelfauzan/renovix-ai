import { ConflictException, Injectable } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import type { CreditAccount, CreditLedgerEntry, CreditReservation, CreditReservationStatus, CreditWallet } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { ModelCallCostService } from "../../model-call-costs/service/model-call-cost.service";
import { ApiKeyRepository } from "../../auth/repository/api-key.repository";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import { CreditAccountRepository } from "../repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../repository/credit-ledger-entry.repository";
import { CreditReservationRepository } from "../repository/credit-reservation.repository";
import type { ChargedPart } from "../types/charged-part";
import type { UsageEntry } from "../types/usage-entry";
import type { ReserveRequest } from "../types/reserve-request";
import type { RunReserveRequest } from "../types/run-reserve-request";
import type { UsageRecord } from "../types/usage-record";
import { assertCreditAmount } from "../utils/assert-credit-amount";
import { chargeCall } from "../utils/charge-call";
import { isSameUsage } from "../utils/is-same-usage";
import { startOfJakartaMonth } from "../utils/start-of-jakarta-month";
import { sumChargedCredits } from "../utils/sum-charged-credits";

/**
 * How long a request's hold lives before the sweep may release it (docs/credits.md section 3.1 rule 8): the adapter's
 * 300-second call timeout plus a margin. A call still running after it is charged from the available balance instead.
 */
const RESERVATION_TTL_MS = 10 * 60_000;

/** Expired reservations the sweep reads per batch. */
const SWEEP_BATCH_SIZE = 100;

/** RNX-58a: the wallets a hold with `spendsWeeklyFree` draws from, in order, and the wallet of every other hold. */
const WEEKLY_FREE_THEN_PAID: readonly CreditWallet[] = ["weekly_free", "paid"];
const PAID_ONLY: readonly CreditWallet[] = ["paid"];

/**
 * Reserve, usage, settle and release on the credit ledger (RX-22, docs/credits.md sections 2.2 and 3). Every write is
 * one short transaction on the locked account row; none spans a model call or a stream.
 */
@Injectable()
export class CreditService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly accounts: CreditAccountRepository,
    private readonly entries: CreditLedgerEntryRepository,
    private readonly reservations: CreditReservationRepository,
    private readonly callCosts: ModelCallCostService,
    private readonly apiKeys: ApiKeyRepository,
  ) {}

  /**
   * Holds `amount` on the user's paid wallet for one request: one conditional update (available covers it, wallet not
   * frozen) and the open reservation row, in one transaction. CreditsExhaustedException (402), writing nothing, when the
   * wallet cannot cover it or does not exist. RNX-232: a request made with an API key first passes the key's monthly
   * cap (`assertUnderKeyCap`, same transaction) and its reservation records the key. RNX-58a: with `spendsWeeklyFree`
   * the weekly_free wallet's available credits are held first (`reserveWeeklyFree`) and only the rest on the paid
   * wallet; the returned reservation is then the weekly_free part, and the paid part (when there is one) names it.
   */
  async reserve(request: ReserveRequest): Promise<CreditReservation> {
    assertCreditAmount(request.amount);
    return this.transactions.run(async (tx) => {
      if (request.apiKeyId) await this.assertUnderKeyCap(request.apiKeyId, tx);
      const weeklyFree = request.spendsWeeklyFree ? await this.reserveWeeklyFree(request, tx) : null;
      const amount = request.amount.minus(weeklyFree?.amountHeld ?? 0);
      if (weeklyFree && amount.isZero()) return weeklyFree;
      const accountId = await this.accounts.addHold({ userId: request.userId }, "paid", amount, tx);
      if (!accountId) throw new CreditsExhaustedException();
      const paid = await this.reservations.createReservation(
        {
          accountId,
          wallet: "paid",
          partOfId: weeklyFree?.id,
          requestId: request.requestId,
          apiKeyId: request.apiKeyId,
          amountHeld: amount,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
        tx,
      );
      return weeklyFree ?? paid;
    });
  }

  /**
   * The one hold of an agent run (docs/credits.md section 13.3), in one transaction on the locked paid-wallet row:
   * H = min(cap, available), placed only when the wallet is not frozen and available >= `minimum`, and the open
   * reservation row with the run's id (as its request id and run id). CreditsExhaustedException (402), writing nothing,
   * when the wallet cannot cover the minimum or does not exist.
   */
  async reserveRun(request: RunReserveRequest): Promise<CreditReservation> {
    assertCreditAmount(request.cap);
    assertCreditAmount(request.minimum);
    const owner = { userId: request.userId };
    return this.transactions.run(async (tx) => {
      const found = await this.accounts.findAccount(owner, "paid", tx);
      if (!found) throw new CreditsExhaustedException();
      const account = await this.accounts.lockAccount(found.id, tx);
      const amount = Decimal.min(request.cap, account.balance.minus(account.held));
      // addHold's conditional update also refuses a frozen wallet.
      if (amount.lessThan(request.minimum) || !(await this.accounts.addHold(owner, "paid", amount, tx))) {
        throw new CreditsExhaustedException();
      }
      return this.reservations.createReservation(
        {
          accountId: account.id,
          wallet: "paid",
          requestId: request.runId,
          runId: request.runId,
          amountHeld: amount,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
        tx,
      );
    });
  }

  /**
   * Refuses with CreditsExhaustedException (402), writing nothing, when the user's paid wallet has fewer available
   * credits (balance - held, one account row read) than `amount`. A pre-check before any paid work (RX-22 review B1):
   * callers pass a lower bound of the estimate, then `reserve` the real one. RNX-58a: with `spendsWeeklyFree` (as the
   * reservation will have) the weekly_free wallet's available credits count too.
   */
  async assertAvailable(userId: string, amount: Decimal, spendsWeeklyFree = false): Promise<void> {
    const wallets = spendsWeeklyFree ? WEEKLY_FREE_THEN_PAID : PAID_ONLY;
    const accounts = await Promise.all(wallets.map((wallet) => this.accounts.findAccount({ userId }, wallet)));
    const available = accounts.reduce((sum, account) => (account ? sum.plus(account.balance.minus(account.held)) : sum), new Decimal(0));
    if (available.lessThan(amount)) throw new CreditsExhaustedException();
  }

  /**
   * Writes the usage entry of a model call (docs/credits.md section 3.1 rules 4, 6 and 7) in one transaction on the
   * locked account rows: the call's credits, rounded once, come from the reservation's remaining hold, an overrun
   * from the available balance, and the rest is `uncharged` (the balance never goes below 0, I5). A provider error is
   * charged 0 with its credits in `uncharged`. The callId is the idempotency key: a replay of the same call returns
   * the first entry; another call under that callId (other tokens, rates, model or outcome) is a 409, nothing written.
   * RNX-58a: on a two-wallet hold each wallet part that the call charges gets its own entry on its own wallet
   * (decision 5a), weekly_free first (`appendUsageToLockedAccounts`); the last entry is returned, with `totalCharged`
   * (RNX-340): what all the call's entries charged, for the usage_logs cost.
   * RNX-162: once the entry has committed, the call's model_call_costs row (`record.cost`), outside the entry's
   * transaction: its failure is logged and never fails the call (ModelCallCostService.record does not throw).
   */
  async recordUsage(record: UsageRecord): Promise<UsageEntry> {
    const parts = await this.reservations.findParts(record.reservationId);
    const entry = await this.transactions.run((tx) => this.appendUsageToLockedAccounts(parts, record, tx));
    await this.callCosts.record({ entry, record });
    return entry;
  }

  /**
   * Records a model call and ends its request: the usage entry (`recordUsage`), then a provider error releases the
   * hold and any other outcome settles it (decided by the entry written, so a replay closes it the same way).
   * Returns the usage entry.
   */
  async finishCall(record: UsageRecord): Promise<UsageEntry> {
    const entry = await this.recordUsage(record);
    await this.closeReservation(record.reservationId, entry.outcome === "provider_error" ? "released" : "settled");
    return entry;
  }

  /** Ends a request: releases the rest of the hold (amountHeld - consumed) and marks the reservation settled. */
  async settle(reservationId: string): Promise<void> {
    await this.closeReservation(reservationId, "settled");
  }

  /** Ends a failed request: releases the rest of the hold and marks the reservation released. */
  async release(reservationId: string): Promise<void> {
    await this.closeReservation(reservationId, "released");
  }

  /**
   * The sweep (docs/credits.md section 3.1 rule 8): marks every open reservation past its expiresAt `expired` and
   * releases its hold, reading in batches through the (status, expiresAt) index. Each reservation is closed by its own
   * conditional update, so concurrent sweeps on several instances close each one exactly once. Returns how many this
   * call closed.
   */
  async expireOverdueReservations(now: Date = new Date()): Promise<number> {
    let expired = 0;
    for (;;) {
      const batch = await this.reservations.findExpiredOpenReservations(now, SWEEP_BATCH_SIZE);
      for (const reservation of batch) {
        const closed = await this.transactions.run((tx) =>
          this.closeOnLockedAccount(reservation.accountId, reservation.id, "expired", tx),
        );
        if (closed) expired += 1;
      }
      if (batch.length < SWEEP_BATCH_SIZE) return expired;
    }
  }

  /**
   * RNX-232 (D47): the monthly cap of an API key, checked on the locked key row so that a key's reservations pass it one
   * at a time: CreditsExhaustedException (402) when the key's usage in this Asia/Jakarta calendar month plus what its
   * open reservations still hold has reached the cap. A call that starts under the cap may go over it (its estimate
   * or its overrun), so the month ends at most one call's charge above the cap. No cap: no check.
   */
  private async assertUnderKeyCap(apiKeyId: string, tx: DbTransaction): Promise<void> {
    const cap = await this.apiKeys.lockKeyCap(apiKeyId, tx);
    if (cap === null) return;
    // Holds first, then usage: recordUsage (no key lock) moves a call's charge from held to used in one commit, so a
    // commit between the two reads is counted twice (conservative), never zero times (review round 1).
    const held = await this.reservations.sumOpenKeyHolds(apiKeyId, tx);
    const used = await this.entries.sumKeyUsageSince(apiKeyId, startOfJakartaMonth(new Date()), tx);
    if (used.plus(held).greaterThanOrEqualTo(cap)) throw new CreditsExhaustedException();
  }

  /**
   * RNX-58a: the weekly_free part of a hold, inside `reserve`'s transaction. Locks the user's weekly_free account row
   * and holds min(amount, available) on it. Null, holding nothing, when the user has no weekly_free wallet (it is
   * created at sign-up, ensureWeeklyFreeWallet), or it has nothing available or is frozen.
   */
  private async reserveWeeklyFree(request: ReserveRequest, tx: DbTransaction): Promise<CreditReservation | null> {
    const owner = { userId: request.userId };
    const found = await this.accounts.findAccount(owner, "weekly_free", tx);
    if (!found) return null;
    const account = await this.accounts.lockAccount(found.id, tx);
    const amount = Decimal.min(request.amount, account.balance.minus(account.held));
    // addHold's conditional update also refuses a frozen wallet.
    if (!amount.greaterThan(0) || !(await this.accounts.addHold(owner, "weekly_free", amount, tx))) return null;
    return this.reservations.createReservation(
      {
        accountId: account.id,
        wallet: "weekly_free",
        requestId: request.requestId,
        apiKeyId: request.apiKeyId,
        amountHeld: amount,
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      },
      tx,
    );
  }

  /**
   * The body of `recordUsage`, inside its transaction: locks the parts' account rows in the parts' order (weekly_free
   * before paid, as `reserve` does), returns the last of a replay's entries, else charges the call (`chargeCall`) and
   * appends one entry per charged part. I3 keeps one usage entry per callId: the last entry has the call's callId (the
   * one its model_call_costs row and the RNX-228 rollup read); an earlier one (the weekly_free part of a call that also
   * reached paid) has `<callId>:weekly_free`. Every entry's idempotency key is the call's callId.
   */
  private async appendUsageToLockedAccounts(
    found: readonly CreditReservation[],
    record: UsageRecord,
    tx: DbTransaction,
  ): Promise<UsageEntry> {
    const accounts: CreditAccount[] = [];
    for (const { accountId } of found) accounts.push(await this.accounts.lockAccount(accountId, tx));
    const replayed = await this.findReplayedEntries(accounts, record.callId, tx);
    if (replayed.length > 0 && !isSameUsage(replayed, record)) {
      throw new ConflictException("This call already has another usage entry");
    }
    if (replayed.length > 0) return { ...replayed[replayed.length - 1], totalCharged: sumChargedCredits(replayed) };
    const reservations = await this.reservations.findParts(record.reservationId, tx);
    const charged = chargeCall(record, reservations.map((reservation, i) => ({ reservation, account: accounts[i] })));
    const entries: CreditLedgerEntry[] = [];
    for (const [i, part] of charged.entries()) {
      const callId = i === charged.length - 1 ? record.callId : `${record.callId}:${part.account.wallet}`;
      entries.push(await this.appendPartUsage(part, record, callId, tx));
    }
    return { ...entries[entries.length - 1], totalCharged: sumChargedCredits(entries) };
  }

  /** The entries already written under this call's idempotency key on these locked accounts, in their order. */
  private async findReplayedEntries(accounts: readonly CreditAccount[], callId: string, tx: DbTransaction): Promise<CreditLedgerEntry[]> {
    const replayed: CreditLedgerEntry[] = [];
    for (const account of accounts) {
      const entry = await this.entries.findEntryByIdempotencyKey(account.id, callId, tx);
      if (entry) replayed.push(entry);
    }
    return replayed;
  }

  /** Appends one part's usage entry under `callId` and moves its charge off the locked account's balance and hold. */
  private async appendPartUsage(part: ChargedPart, record: UsageRecord, callId: string, tx: DbTransaction): Promise<CreditLedgerEntry> {
    const { account, reservation, charge } = part;
    const charged = charge.fromHold.plus(charge.fromAvailable);
    const balanceAfter = account.balance.minus(charged);
    const seq = account.lastSeq + 1;
    const entry = await this.entries.createEntry(
      {
        accountId: account.id,
        wallet: account.wallet,
        seq,
        type: "usage",
        amount: charged.negated(),
        balanceAfter,
        uncharged: charge.uncharged,
        memberUserId: record.memberUserId,
        requestId: record.requestId,
        callId,
        runId: record.runId,
        agentId: record.agentId,
        parentCallId: record.parentCallId,
        modelId: record.modelId,
        tier: record.tier,
        ...record.rates,
        ...record.tokens,
        outcome: record.outcome,
        idempotencyKey: record.callId,
        apiKeyId: record.apiKeyId,
      },
      tx,
    );
    await this.accounts.updateBalanceAndHeld(account.id, balanceAfter, account.held.minus(charge.fromHold), seq, tx);
    if (charge.fromHold.greaterThan(0)) await this.reservations.addConsumed(reservation.id, charge.fromHold, tx);
    return entry;
  }

  /**
   * Closes a reservation with `status` in one transaction on its locked account rows (RNX-58a: every part, in the
   * parts' order); a closed part is left as it is.
   */
  private async closeReservation(reservationId: string, status: CreditReservationStatus): Promise<void> {
    const parts = await this.reservations.findParts(reservationId);
    await this.transactions.run(async (tx) => {
      for (const part of parts) await this.closeOnLockedAccount(part.accountId, part.id, status, tx);
    });
  }

  /**
   * Locks the account row, closes the reservation if it is still open and releases its remaining hold. True when this
   * call closed it, false when it was already closed.
   */
  private async closeOnLockedAccount(
    accountId: string,
    reservationId: string,
    status: CreditReservationStatus,
    tx: DbTransaction,
  ): Promise<boolean> {
    await this.accounts.lockAccount(accountId, tx);
    const remaining = await this.reservations.closeReservation(reservationId, status, tx);
    if (remaining === null) return false;
    if (remaining.greaterThan(0)) await this.accounts.releaseHold(accountId, remaining, tx);
    return true;
  }
}
