"use client";

import { useState } from "react";
import type { ReasonRequest } from "@/lib/admins/reason-request";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { UserDetail } from "@/lib/users/user-detail";
import type { UsersApi } from "@/lib/users/users-api";
import { AdminActionButton } from "../admins/admin-action-button";
import { ReasonDialog } from "../admins/reason-dialog";
import { SectionMessage } from "../usage/section-message";

type UserDetailActionsProps = {
  readonly detail: UserDetail;
  readonly api: UsersApi;
  /** Reloads the detail once the status has changed. */
  readonly onStatusChange: () => void;
};

/**
 * The account actions of a user's detail (RNX-100), shown with `users:write` (visibility only: the API enforces it):
 * Reset API keys, and Suspend, or Reinstate for a suspended user. Each asks for its reason in the reason dialog first
 * and sends nothing until it is confirmed; a refusal shows the API's message.
 */
export function UserDetailActions({ detail, api, onStatusChange }: UserDetailActionsProps) {
  const [request, setRequest] = useState<ReasonRequest | null>(null);
  const [message, setMessage] = useState<{ readonly text: string; readonly isError: boolean } | null>(null);
  const isSuspended = detail.status === "suspended";
  const fail = (err: unknown) => setMessage({ text: describeFailure(err), isError: true });
  const changeStatus = (reason: string) => (isSuspended ? api.reinstate(detail.id, reason) : api.suspend(detail.id, reason)).then(onStatusChange, fail);
  const resetKeys = (reason: string) => api.resetApiKeys(detail.id, reason).then(({ revoked }) => setMessage({ text: `API keys revoked: ${revoked}.`, isError: false }), fail);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <AdminActionButton label="Reset API keys…" onClick={() => setRequest({ title: `Reset the API keys of user ${detail.id}`, confirm: (reason) => void resetKeys(reason) })} />
        <AdminActionButton
          label={isSuspended ? "Reinstate…" : "Suspend…"}
          onClick={() => setRequest({ title: `${isSuspended ? "Reinstate" : "Suspend"} user ${detail.id}`, confirm: (reason) => void changeStatus(reason) })}
        />
      </div>
      {message && <SectionMessage text={message.text} isError={message.isError} />}
      {request && <ReasonDialog request={request} onClose={() => setRequest(null)} />}
    </div>
  );
}
