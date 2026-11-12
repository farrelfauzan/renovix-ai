"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
import type { ActionOutcome } from "@/lib/admins/action-outcome";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { IssuedInvitation } from "@/lib/admins/issued-invitation";
import { InviteConflict } from "./invite-conflict";

const CONFLICT = 409;

type InviteDialogProps = {
  readonly api: AdminsApi;
  readonly roles: readonly AdminRole[];
  /** The list as loaded: a 409 for an email with a pending invitation points at that row's resend and revoke. */
  readonly admins: readonly AdminListEntry[];
  /** Runs an API call with the re-authentication prompt, refetching the lists after a success. */
  readonly run: <T>(action: () => Promise<T>) => Promise<ActionOutcome<T>>;
  readonly onIssued: (issued: IssuedInvitation) => void;
  readonly onClose: () => void;
};

/** Invites an email with a role (`admins:write`); the answer's link goes to the link dialog (shown once). */
export function InviteDialog({ api, roles, admins, run, onIssued, onClose }: InviteDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0]?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminListEntry | null>(null);
  const finish = async <T,>(action: () => Promise<T>, onDone: (value: T) => void) => {
    const outcome = await run(action);
    if (!outcome.ok) return setError(outcome.message);
    onDone(outcome.value);
    onClose();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(null);
    const outcome = await run(() => api.invite(email, role));
    if (outcome.ok) {
      onIssued(outcome.value);
      return onClose();
    }
    setError(outcome.message);
    if (outcome.status === CONFLICT) setPending(admins.find((entry) => entry.status === "invited" && entry.email.toLowerCase() === email.toLowerCase()) ?? null);
  };
  return (
    <form role="dialog" aria-label="Invite an admin" onSubmit={submit} className="mt-4 flex max-w-sm flex-col gap-3 rounded-rx border border-rx-line p-4">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <Input type="email" name="email" autoComplete="off" required value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Role
        <Select name="role" value={role} onValueChange={setRole}>
          <SelectTrigger className="w-full rounded-rx border-rx-line px-2 py-1 data-[size=default]:h-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((entry) => (
              <SelectItem key={entry.name} value={entry.name}>{entry.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      {pending && <InviteConflict pending={pending} onResend={() => finish(() => api.resendInvitation(pending.id), onIssued)} onRevoke={() => finish(() => api.revokeInvitation(pending.id), () => undefined)} />}
      <div className="flex gap-2">
        <Button variant="outline" type="submit" className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Send invitation</Button>
        <Button variant="outline" type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Cancel</Button>
      </div>
    </form>
  );
}
