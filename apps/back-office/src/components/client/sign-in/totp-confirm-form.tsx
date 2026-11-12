"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";

/** The first code of the newly added authenticator, which confirms the TOTP enrolment (RX-94). */
export function TotpConfirmForm({ isSubmitting, onConfirm }: { isSubmitting: boolean; onConfirm: (code: string) => void }) {
  const [code, setCode] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm(code);
  };
  return (
    <form aria-label="Confirm authenticator" onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Code from your authenticator app
        <Input type="text" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm" />
      </label>
      <Button variant="outline" type="submit" disabled={isSubmitting} className="self-start rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
        Confirm
      </Button>
    </form>
  );
}
