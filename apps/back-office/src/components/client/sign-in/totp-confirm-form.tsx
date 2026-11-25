"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { AuthenticatorCodeInput } from "@/components/client/form/authenticator-code-input";
import { AUTHENTICATOR_CODE_LENGTH } from "@/lib/sign-in/authenticator-code-length";

/**
 * The first code of the newly added authenticator, which confirms the TOTP enrolment (RX-94), in the six boxes of
 * RNX-332 (RNX-333). A code of fewer than six digits is not sent.
 */
export function TotpConfirmForm({ isSubmitting, onConfirm }: { isSubmitting: boolean; onConfirm: (code: string) => void }) {
  const [code, setCode] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length < AUTHENTICATOR_CODE_LENGTH) return;
    onConfirm(code);
  };
  return (
    <form aria-label="Confirm authenticator" onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-medium">Enter the code the app shows to confirm</legend>
        <AuthenticatorCodeInput value={code} onChange={setCode} />
      </fieldset>
      <Button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">
        Confirm authenticator
      </Button>
    </form>
  );
}
