"use client";

import { useState, type FormEvent } from "react";
import type { InvitationPreview } from "@/lib/invitation/invitation-preview";

type AcceptInvitationFormProps = {
  readonly preview: InvitationPreview;
  readonly isSubmitting: boolean;
  readonly onSubmit: (name: string, password: string) => void;
};

/** Who invited and with which role, the invitation's email (read-only: the API takes it from the invitation), and the new admin's name and password (RX-95). */
export function AcceptInvitationForm({ preview, isSubmitting, onSubmit }: AcceptInvitationFormProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(name, password);
  };
  const inviter = preview.invitedBy.name ? `${preview.invitedBy.name} (${preview.invitedBy.email})` : preview.invitedBy.email;
  return (
    <form aria-label="Complete invitation" onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <p className="text-sm">
        {inviter} invited you to the Renovix back-office with the role <strong>{preview.role}</strong>.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input type="email" name="email" autoComplete="username" readOnly value={preview.email} className="rounded border border-neutral-200 bg-neutral-100 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input type="text" name="name" autoComplete="name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-neutral-300 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input type="password" name="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="rounded border border-neutral-300 px-2 py-1" />
      </label>
      <button type="submit" disabled={isSubmitting} className="self-start rounded border border-neutral-300 px-3 py-1 text-sm">
        Create account
      </button>
    </form>
  );
}
