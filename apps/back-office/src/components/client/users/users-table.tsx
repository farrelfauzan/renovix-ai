"use client";

import { Button } from "@performa-ai/ui/components/button";
import type { UserListItem } from "@/lib/users/user-list-item";
import { UserStatusPill } from "./user-status-pill";
import { formatDateTime } from "@/lib/users/format-date-time";
import { shortenUserId } from "@/lib/users/shorten-user-id";

const HEADERS = ["User", "Email", "Package", "Available credits", "Status", "Last sign-in"];
const CELL = "px-2.5 py-2";

type UsersTableProps = {
  readonly items: readonly UserListItem[];
  readonly selectedId: string | null;
  readonly onOpen: (id: string) => void;
};

/** One page of users as the API listed them; the user id opens the detail. Scrolls sideways inside its own border. */
export function UsersTable({ items, selectedId, onOpen }: UsersTableProps) {
  return (
    <div className="relative overflow-x-auto rounded-rx border border-rx-line">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="bg-rx-surface text-rx-muted">
          <tr>
            {HEADERS.map((header) => (
              <th key={header} className={`${CELL} whitespace-nowrap font-medium ${header === "Available credits" ? "text-right" : ""}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((user) => (
            <tr key={user.id} className={`border-t border-rx-line ${user.id === selectedId ? "bg-rx-accent-fill" : ""}`}>
              <td className={`${CELL} whitespace-nowrap`}>
                <Button variant="link" type="button" aria-label={`Open user ${user.id}`} aria-current={user.id === selectedId ? "true" : undefined} onClick={() => onOpen(user.id)} className="h-auto p-0 font-mono text-[13px] font-normal text-rx-accent">
                  {shortenUserId(user.id)}
                </Button>
              </td>
              <td className={`${CELL} font-mono`}>{user.email}</td>
              <td className={CELL}>{user.package?.name ?? "none"}</td>
              <td className={`${CELL} text-right font-mono`}>{user.creditsAvailable}</td>
              <td className={CELL}><UserStatusPill status={user.status} /></td>
              <td className={`${CELL} whitespace-nowrap text-rx-muted`}>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "never"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
