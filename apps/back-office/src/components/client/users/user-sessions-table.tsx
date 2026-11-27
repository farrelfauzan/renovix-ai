"use client";

import { LogOut } from "lucide-react";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
import { formatDateTime } from "@/lib/users/format-date-time";
import type { UserSession } from "@/lib/users/user-session";

const HEADERS = ["Created", "Expires", "User agent"];
const CELL = "px-2.5 py-2";

type UserSessionsTableProps = {
  readonly sessions: readonly UserSession[];
  /** Revokes one session; without it (no `users:write`) the table has no actions column. */
  readonly onRevoke?: (session: UserSession) => void;
};

/** A user's sessions (RNX-100), newest first; each row's Revoke is an icon button with a tooltip (D406). */
export function UserSessionsTable({ sessions, onRevoke }: UserSessionsTableProps) {
  if (!sessions.length) return <p className="text-sm text-rx-muted">No sessions.</p>;
  return (
    <div className="relative overflow-x-auto rounded-rx border border-rx-line">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="bg-rx-surface text-rx-muted">
          <tr>
            {[...HEADERS, ...(onRevoke ? ["Actions"] : [])].map((header) => (
              <th key={header} className={`${CELL} whitespace-nowrap font-medium`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id} className="border-t border-rx-line">
              <td className={`${CELL} whitespace-nowrap font-mono text-rx-muted`}>{formatDateTime(session.createdAt)}</td>
              <td className={`${CELL} whitespace-nowrap font-mono text-rx-muted`}>{formatDateTime(session.expiresAt)}</td>
              <td className={`${CELL} break-all`}>{session.userAgent ?? "not sent"}</td>
              {onRevoke && (
                <td className={CELL}>
                  <IconActionButton title="Revoke" tone="destructive" label={`Revoke session ${session.id}`} icon={LogOut} onClick={() => onRevoke(session)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
