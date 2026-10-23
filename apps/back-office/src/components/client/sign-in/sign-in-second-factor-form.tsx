"use client";

import { useState, type FormEvent } from "react";
import type { SecondFactor } from "@/lib/sign-in/second-factor";

type SignInSecondFactorFormProps = {
  readonly isSubmitting: boolean;
  readonly onSubmit: (factor: SecondFactor) => void;
  readonly onBack: () => void;
};

/**
 * Second step of the sign-in (RX-94): the authenticator code, or a recovery code instead. An admin without
 * TOTP yet continues without a code; the API then answers with an enrolment session.
 */
export function SignInSecondFactorForm({ isSubmitting, onSubmit, onBack }: SignInSecondFactorFormProps) {
  const [usesRecoveryCode, setUsesRecoveryCode] = useState(false);
  const [code, setCode] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(usesRecoveryCode ? { recoveryCode: code } : { totp: code });
  };
  const switchFactor = () => {
    setUsesRecoveryCode(!usesRecoveryCode);
    setCode("");
  };
  return (
    <form aria-label="Second factor" onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {usesRecoveryCode ? "Recovery code" : "Authenticator code"}
        {usesRecoveryCode ? (
          <input key="recovery-code" type="text" name="recoveryCode" autoComplete="one-time-code" required maxLength={64} value={code} onChange={(event) => setCode(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1" />
        ) : (
          <input key="totp" type="text" name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1" />
        )}
      </label>
      <button type="submit" disabled={isSubmitting} className="self-start rounded-rx border border-rx-line px-3 py-1 text-sm">
        Sign in
      </button>
      <button type="button" onClick={switchFactor} className="self-start text-sm underline">
        {usesRecoveryCode ? "Use the authenticator code instead" : "Use a recovery code instead"}
      </button>
      <button type="button" disabled={isSubmitting} onClick={() => onSubmit({})} className="self-start text-sm underline">
        No authenticator set up yet: continue without a code
      </button>
      <button type="button" onClick={onBack} className="self-start text-sm underline">
        Back
      </button>
    </form>
  );
}
