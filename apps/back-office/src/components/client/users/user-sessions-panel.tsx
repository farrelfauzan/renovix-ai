"use client";

import { useCallback, useState } from "react";
import type { ReasonRequest } from "@/lib/admins/reason-request";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import { useReport } from "@/lib/usage/use-report";
import type { UsersApi } from "@/lib/users/users-api";
import { AdminActionButton } from "../admins/admin-action-button";
import { ReasonDialog } from "../admins/reason-dialog";
import { SectionMessage } from "../usage/section-message";
import { UserSessionsTable } from "./user-sessions-table";

type UserSessionsPanelProps = {
  readonly userId: string;
  readonly api: UsersApi;
  /** Holds `users:write`: Revoke and Revoke all show (visibility only: the API enforces it). */
  readonly canWrite: boolean;
};

/**
 * The Sessions tab of a user's detail (RNX-100), loaded when the tab opens: the sessions without token or IP address,
 * with Revoke per row and Revoke all. Each asks for its reason first; the list is read again after a revoke.
 */
export function UserSessionsPanel({ userId, api, canWrite }: UserSessionsPanelProps) {
  const { data, error, reload } = useReport(useCallback(() => api.listSessions(userId), [api, userId]));
  const [request, setRequest] = useState<ReasonRequest | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const ask = (title: string, write: (reason: string) => Promise<unknown>) =>
    setRequest({ title, confirm: (reason) => void write(reason).then(() => { setFailure(null); reload(); }, (err: unknown) => setFailure(describeFailure(err))) });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-rx-muted">Newest first. The session token and the IP address are never shown.</span>
        {canWrite && data && data.sessions.length > 0 && (
          <AdminActionButton label="Revoke all" onClick={() => ask(`Revoke all sessions of user ${userId}`, (reason) => api.revokeAllSessions(userId, reason))} />
        )}
      </div>
      {failure && <SectionMessage text={failure} isError />}
      {error && <SectionMessage text={`The sessions could not be loaded: ${error}`} isError />}
      {!data && !error && <SectionMessage text="Loading the sessions…" />}
      {data && (
        <UserSessionsTable
          sessions={data.sessions}
          onRevoke={canWrite ? (session) => ask(`Revoke session ${session.id}`, (reason) => api.revokeSession(userId, session.id, reason)) : undefined}
        />
      )}
      {request && <ReasonDialog request={request} onClose={() => setRequest(null)} />}
    </div>
  );
}
