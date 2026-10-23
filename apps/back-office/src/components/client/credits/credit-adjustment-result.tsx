"use client";

import type { CreditAdjustmentEntry } from "@/lib/credits/credit-adjustment-entry";

/** The ledger entry an adjustment wrote and the balance after it, as the API answered. */
export function CreditAdjustmentResult({ entry }: { entry: CreditAdjustmentEntry }) {
  return (
    <div role="status" aria-label="Ledger entry" className="flex flex-col gap-1 rounded-rx border border-rx-line bg-rx-surface p-3 text-sm">
      <p>Adjustment recorded. New balance <span className="font-mono">{entry.balanceAfter}</span> credits.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-rx-muted">
        <dt>Entry</dt>
        <dd className="font-mono break-all">{entry.entryId}</dd>
        <dt>Wallet</dt>
        <dd>{entry.wallet}</dd>
        <dt>Amount</dt>
        <dd className="font-mono">{entry.amount}</dd>
        <dt>Admin</dt>
        <dd className="font-mono break-all">{entry.adminId}</dd>
        <dt>Action id</dt>
        <dd className="font-mono break-all">{entry.actionId ?? "none"}</dd>
        <dt>At</dt>
        <dd>{entry.createdAt}</dd>
      </dl>
    </div>
  );
}
