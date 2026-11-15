"use client";

import type { ApiKeyListItem } from "@/lib/api-key-types";
import { KeyRow } from "./key-row";

interface KeysTableProps {
  keys: ApiKeyListItem[];
  onRevokeAction: (keyId: string) => void;
}

const COLUMNS = ["Name", "Key", "Allowed tiers", "Created", "Last used", "Credits, 30 days", ""];

/** The user's keys: name, prefix, allowed tiers, created, last used, credits in the last 30 days, Revoke. */
export function KeysTable({ keys, onRevokeAction }: KeysTableProps) {
  if (keys.length === 0) return <p className="text-sm text-muted-foreground">No keys yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-secondary/30 text-left text-muted-foreground">
            {COLUMNS.map((label) => (
              <th key={label} className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((apiKey) => (
            <KeyRow key={apiKey.id} apiKey={apiKey} onRevokeAction={onRevokeAction} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
