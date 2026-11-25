"use client";

import type { UserLedgerEntry } from "@/lib/users/user-ledger-entry";
import { formatDateTime } from "@/lib/users/format-date-time";

const HEADERS = ["When", "Entry", "Wallet", "Credits", "Balance after"];
const RIGHT_ALIGNED = new Set(["Credits", "Balance after"]);
const CELL = "px-2.5 py-2";

/** The user's latest ledger entries (the API sends at most 20, newest first). Scrolls sideways inside its own border. */
export function UserLedgerTable({ entries }: { readonly entries: readonly UserLedgerEntry[] }) {
  if (!entries.length) return <p className="text-sm text-rx-muted">No ledger entries.</p>;
  return (
    <div className="relative overflow-x-auto rounded-rx border border-rx-line">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="bg-rx-surface text-rx-muted">
          <tr>
            {HEADERS.map((header) => (
              <th key={header} className={`${CELL} whitespace-nowrap font-medium ${RIGHT_ALIGNED.has(header) ? "text-right" : ""}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-rx-line">
              <td className={`${CELL} whitespace-nowrap font-mono text-rx-muted`}>{formatDateTime(entry.createdAt)}</td>
              <td className={CELL}>{entry.type}</td>
              <td className={CELL}>{entry.wallet}</td>
              <td className={`${CELL} text-right font-mono`}>{entry.amount}</td>
              <td className={`${CELL} text-right font-mono`}>{entry.balanceAfter}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
