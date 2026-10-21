import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { CreditAccountOwner } from "../../billing/types/credit-account-owner";
import type { CreditAdjustmentOutcome } from "../types/credit-adjustment-outcome";
import type { CreditAdjustmentRequest } from "../types/credit-adjustment-request";

/**
 * The response and the audit change of a credit adjustment (RNX-227), from its ledger entry. Both describe the
 * entry, so a replay (the entry of an earlier request: its reference is not this request's action id) answers the
 * same body, and its audit row records the same outcome, marked `replayed: true`. The reason goes into the audit
 * row's reason column.
 */
export function buildCreditAdjustmentOutcome(entry: CreditLedgerEntry, { actionId, adjustment }: CreditAdjustmentRequest): CreditAdjustmentOutcome {
  const target: CreditAccountOwner = adjustment.target;
  const account = { accountId: entry.accountId, userId: target.userId ?? null, companyId: target.companyId ?? null };
  return {
    result: {
      entryId: entry.id,
      accountId: entry.accountId,
      wallet: entry.wallet,
      amount: entry.amount.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      adminId: entry.memberUserId,
      actionId: entry.reference,
      createdAt: entry.createdAt,
    },
    change: {
      before: { ...account, balance: entry.balanceAfter.minus(entry.amount).toString() },
      after: {
        ...account,
        entryId: entry.id,
        actionId: entry.reference,
        direction: adjustment.direction,
        amount: entry.amount.toString(),
        balance: entry.balanceAfter.toString(),
        ticketReference: adjustment.ticketReference ?? null,
        paymentReference: adjustment.paymentReference ?? null,
        replayed: entry.reference !== actionId,
      },
      reason: adjustment.reason,
    },
  };
}
