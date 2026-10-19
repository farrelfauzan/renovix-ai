import { Injectable } from "@nestjs/common";
import type { CreditLedgerEntry, CreditReservation, CreditReservationStatus } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import { CreditAccountRepository } from "../repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../repository/credit-ledger-entry.repository";
import { CreditReservationRepository } from "../repository/credit-reservation.repository";
import type { ReserveRequest } from "../types/reserve-request";
import type { UsageRecord } from "../types/usage-record";
import { assertCreditAmount } from "../utils/assert-credit-amount";
import { chargeCall } from "../utils/charge-call";

/**
 * How long a request's hold lives before the sweep may release it (docs/credits.md section 3.1 rule 8): the adapter's
 * 300-second call timeout plus a margin. A call still running after it is charged from the available balance instead.
 */
const RESERVATION_TTL_MS = 10 * 60_000;

/** Expired reservations the sweep reads per batch. */
const SWEEP_BATCH_SIZE = 100;

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
  ) {}

  /**
   * Holds `amount` on the user's paid wallet for one request: one conditional update (available covers it, wallet not
   * frozen) and the open reservation row, in one transaction. CreditsExhaustedException (402), writing nothing, when the
   * wallet cannot cover it or does not exist.
   */
  async reserve(request: ReserveRequest): Promise<CreditReservation> {
    assertCreditAmount(request.amount);
    return this.transactions.run(async (tx) => {
      const accountId = await this.accounts.addHold({ userId: request.userId }, "paid", request.amount, tx);
      if (!accountId) throw new CreditsExhaustedException();
      return this.reservations.createReservation(
        {
          accountId,
          wallet: "paid",
          requestId: request.requestId,
          amountHeld: request.amount,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
        tx,
      );
    });
  }

  /**
   * Writes the one usage entry of a model call (docs/credits.md section 3.1 rules 4, 6 and 7) in one transaction on
   * the locked account row: the call's credits, rounded once, come from the reservation's remaining hold, an overrun
   * from the available balance, and the rest is `uncharged` (the balance never goes below 0, I5). A provider error is
   * charged 0 with its credits in `uncharged`. The callId is the idempotency key: a replay returns the first entry.
   */
  async recordUsage(record: UsageRecord): Promise<CreditLedgerEntry> {
    const { accountId } = await this.reservations.findReservation(record.reservationId);
    return this.transactions.run((tx) => this.appendUsageToLockedAccount(accountId, record, tx));
  }

  /**
   * Records a model call and ends its request: the usage entry (`recordUsage`), then a provider error releases the
   * hold and any other outcome settles it (decided by the entry written, so a replay closes it the same way).
   * Returns the usage entry.
   */
  async finishCall(record: UsageRecord): Promise<CreditLedgerEntry> {
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

  /** The body of `recordUsage`, inside its transaction. */
  private async appendUsageToLockedAccount(accountId: string, record: UsageRecord, tx: DbTransaction): Promise<CreditLedgerEntry> {
    const account = await this.accounts.lockAccount(accountId, tx);
    const replayed = await this.entries.findEntryByIdempotencyKey(accountId, record.callId, tx);
    if (replayed) return replayed;
    const reservation = await this.reservations.findReservation(record.reservationId, tx);
    const charge = chargeCall(record, reservation, account);
    const charged = charge.fromHold.plus(charge.fromAvailable);
    const balanceAfter = account.balance.minus(charged);
    const seq = account.lastSeq + 1;
    const entry = await this.entries.createEntry(
      {
        accountId,
        wallet: account.wallet,
        seq,
        type: "usage",
        amount: charged.negated(),
        balanceAfter,
        uncharged: charge.uncharged,
        memberUserId: record.memberUserId,
        requestId: record.requestId,
        callId: record.callId,
        modelId: record.modelId,
        tier: record.tier,
        ...record.rates,
        ...record.tokens,
        outcome: record.outcome,
        idempotencyKey: record.callId,
      },
      tx,
    );
    await this.accounts.updateBalanceAndHeld(accountId, balanceAfter, account.held.minus(charge.fromHold), seq, tx);
    if (charge.fromHold.greaterThan(0)) await this.reservations.addConsumed(reservation.id, charge.fromHold, tx);
    return entry;
  }

  /** Closes a reservation with `status` in one transaction on its locked account row; a closed one is left as it is. */
  private async closeReservation(reservationId: string, status: CreditReservationStatus): Promise<void> {
    const { accountId } = await this.reservations.findReservation(reservationId);
    await this.transactions.run((tx) => this.closeOnLockedAccount(accountId, reservationId, status, tx));
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
