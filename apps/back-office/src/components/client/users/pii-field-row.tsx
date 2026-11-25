"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { PiiField } from "@/lib/users/pii-field";
import type { UserReveal } from "@/lib/users/user-reveal";
import type { UsersApi } from "@/lib/users/users-api";
import { SectionMessage } from "../usage/section-message";

/** Longest reason the API accepts for a reveal. */
const MAX_REASON_LENGTH = 500;
const SMALL_BUTTON = "h-8 rounded-rx px-3 text-xs font-medium";

type PiiFieldRowProps = {
  readonly userId: string;
  readonly field: PiiField;
  readonly label: string;
  /** The API's masked value ("***"), or null when the user has not set the field. */
  readonly masked: string | null;
  readonly api: UsersApi;
};

/**
 * One personal field with its Reveal button. Reveal asks for a reason first and sends nothing without one; the
 * revealed value lives only in this component's state (gone when the panel closes or another user opens). The
 * button shows to everyone on the screen: the API decides (403 shows its message).
 */
export function PiiFieldRow({ userId, field, label, masked, api }: PiiFieldRowProps) {
  const [isAsking, setIsAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState<UserReveal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const name = label.toLowerCase();
  const reveal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim() || isSending) return;
    setIsSending(true);
    try {
      setRevealed(await api.revealField(userId, { field, reason: reason.trim() }));
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setIsSending(false);
    }
  };
  const value = revealed ? revealed.value : masked;
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-rx-muted">{label}</dt>
      <dd className="m-0 flex flex-col gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono">{value ?? "not set"}</span>
          {!revealed && !isAsking && (
            <Button variant="link" type="button" aria-label={`Reveal ${name}`} onClick={() => setIsAsking(true)} className="h-auto p-0 text-xs font-medium text-rx-accent">
              Reveal
            </Button>
          )}
        </span>
        {isAsking && !revealed && (
          <form aria-label={`Reveal ${name}`} onSubmit={reveal} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-rx-muted">
              Reason
              <Input maxLength={MAX_REASON_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example, a support ticket number" className="h-9 rounded-rx border-rx-line bg-rx-ground px-2.5 text-[13px] text-rx-text md:text-[13px]" />
            </label>
            <span className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!reason.trim() || isSending} className={`${SMALL_BUTTON} bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover`}>
                Reveal {name}
              </Button>
              <Button variant="outline" type="button" onClick={() => setIsAsking(false)} className={`${SMALL_BUTTON} border-rx-line bg-transparent`}>
                Cancel
              </Button>
            </span>
          </form>
        )}
        {error && <SectionMessage text={error} isError />}
      </dd>
    </div>
  );
}
