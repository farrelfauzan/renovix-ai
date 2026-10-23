"use client";

import { useState, type FormEvent } from "react";
import type { UsageApi } from "@/lib/usage/usage-api";
import type { UsageUser } from "@/lib/usage/usage-user";
import { SectionMessage } from "./section-message";

type UsageUserCellProps = {
  readonly user: UsageUser;
  readonly api: UsageApi;
  /** Held `users:read_pii` (visibility only: the API enforces it and audits the reveal with the reason). */
  readonly canReveal: boolean;
};

/** A user by id with the masked email; with `users:read_pii` a reason form reveals the email. */
export function UsageUserCell({ user, api, canReveal }: UsageUserCellProps) {
  const [isAsking, setIsAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reveal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setEmail((await api.revealEmail(user.id, reason)).email);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The email could not be revealed.");
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs">{user.id}</span>
      <span>{email ?? String(user.email)}</span>
      {canReveal && email === null && !isAsking && (
        <button type="button" onClick={() => setIsAsking(true)} className="self-start text-xs underline">
          Reveal email
        </button>
      )}
      {isAsking && email === null && (
        <form aria-label={`Reveal email of ${user.id}`} onSubmit={reveal} className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-xs text-rx-muted">
            Reason
            <input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 text-rx-text" />
          </label>
          <button type="submit" className="self-start rounded-rx border border-rx-line px-2 py-1 text-xs">
            Reveal
          </button>
        </form>
      )}
      {error && <SectionMessage text={error} isError />}
    </div>
  );
}
