"use client";

import { Check, Circle, CircleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { ADMIN_PASSWORD_MIN_LENGTH } from "@/lib/invitation/admin-password-min-length";
import type { InvitationPreview } from "@/lib/invitation/invitation-preview";
import { InvitationCard } from "./invitation-card";

const FIELD_INPUT = "h-11 rounded-rx border-rx-line bg-rx-white px-3 text-[15px] font-normal md:text-[15px]";

type AcceptInvitationFormProps = {
  readonly preview: InvitationPreview;
  readonly isSubmitting: boolean;
  /** The API's message after a refused submit (a breached or too short password, a used link). */
  readonly error: string | null;
  readonly onSubmit: (name: string, password: string) => void;
};

/**
 * The invitation's password step (RX-95, RNX-333): the new admin's name and password. Only the length gets live
 * feedback, counted in this browser; nothing is sent while typing. The breach check and every other rule run on the
 * API at submit, and its refusal is shown as it says. The invitation's email sits in a hidden, read-only field for
 * password managers (the API takes the email from the invitation).
 */
export function AcceptInvitationForm({ preview, isSubmitting, error, onSubmit }: AcceptInvitationFormProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const length = [...password].length;
  const isLongEnough = length >= ADMIN_PASSWORD_MIN_LENGTH;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(name, password);
  };
  return (
    <InvitationCard>
      <form aria-label="Complete invitation" onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="text-[15px] font-semibold">Password</h2>
        {error && (
          <p role="alert" className="flex items-start gap-2.5 rounded-rx bg-rx-red-tint px-3 py-2.5 text-[13px] text-rx-red-text">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-rx-red-bar" />
            {error}
          </p>
        )}
        <Input type="email" name="email" aria-label="Email" autoComplete="username" readOnly hidden value={preview.email} />
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Name
          <Input type="text" name="name" autoComplete="name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className={FIELD_INPUT} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Password
          <Input type="password" name="password" autoComplete="new-password" aria-describedby="password-length-rule" required value={password} onChange={(event) => setPassword(event.target.value)} className={FIELD_INPUT} />
        </label>
        <div className="flex flex-col gap-1">
          <span id="password-length-rule" className={`flex items-center gap-2 text-xs ${isLongEnough ? "text-rx-ink" : "text-rx-muted"}`}>
            {isLongEnough ? <Check aria-hidden className="size-3.5 text-rx-green" /> : <Circle aria-hidden className="size-3.5" />}
            At least {ADMIN_PASSWORD_MIN_LENGTH} characters ({length} entered)
          </span>
          <span className="text-xs text-rx-muted">Stored with Argon2id.</span>
        </div>
        <Button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">
          Create account
        </Button>
      </form>
    </InvitationCard>
  );
}
