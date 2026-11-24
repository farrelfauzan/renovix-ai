"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { AuthenticatorCodeInput } from "@/components/client/form/authenticator-code-input";
import { AUTHENTICATOR_CODE_LENGTH } from "@/lib/sign-in/authenticator-code-length";
import type { SecondFactor } from "@/lib/sign-in/second-factor";

type SignInSecondFactorFormProps = {
  readonly isSubmitting: boolean;
  readonly onSubmit: (factor: SecondFactor) => void;
  /** The admin says no authenticator is set up yet: shows the not-enrolled state, sends nothing. */
  readonly onNotEnrolled: () => void;
  readonly onBack: () => void;
};

/**
 * Second step of the sign-in (RX-94), the canvas's code card (RNX-332): the authenticator code in six boxes, or
 * a recovery code instead. A code of fewer than six digits is not sent.
 */
export function SignInSecondFactorForm({ isSubmitting, onSubmit, onNotEnrolled, onBack }: SignInSecondFactorFormProps) {
  const [usesRecoveryCode, setUsesRecoveryCode] = useState(false);
  const [code, setCode] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!usesRecoveryCode && code.length < AUTHENTICATOR_CODE_LENGTH) return;
    onSubmit(usesRecoveryCode ? { recoveryCode: code } : { totp: code });
  };
  const switchFactor = () => {
    setUsesRecoveryCode(!usesRecoveryCode);
    setCode("");
  };
  return (
    <form aria-label="Second factor" onSubmit={submit} className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-[-0.01em]">{usesRecoveryCode ? "Enter a recovery code" : "Enter the 6-digit code"}</h1>
        {!usesRecoveryCode && <p className="text-[13px] text-rx-muted">From your authenticator app.</p>}
      </div>
      {usesRecoveryCode ? (
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Recovery code
          <Input key="recovery-code" type="text" name="recoveryCode" autoComplete="one-time-code" required maxLength={64} value={code} onChange={(event) => setCode(event.target.value)} className="h-11 rounded-rx border-rx-line bg-rx-white px-3 font-mono text-[15px] font-normal md:text-[15px]" />
        </label>
      ) : (
        <div className="flex flex-col gap-2">
          <AuthenticatorCodeInput value={code} onChange={setCode} />
          <p className="text-xs text-rx-muted">Codes change every 30 seconds. A code works once.</p>
        </div>
      )}
      <Button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">
        Sign in
      </Button>
      <div className="flex flex-col items-start gap-1.5 border-t border-rx-line pt-3 text-[13px]">
        <Button variant="link" type="button" onClick={switchFactor} className="h-auto min-h-11 p-0 text-[13px] font-normal whitespace-normal text-rx-accent hover:text-rx-accent-hover">
          {usesRecoveryCode ? "Use the authenticator code instead" : "Lost your authenticator? Use a recovery code"}
        </Button>
        <p className="text-xs text-rx-muted">No recovery codes left? An owner can reset your MFA from Admins and roles. The reset is audited and you re-enrol on next sign-in.</p>
        <Button variant="link" type="button" onClick={onNotEnrolled} className="h-auto min-h-11 p-0 text-[13px] font-normal whitespace-normal text-rx-accent hover:text-rx-accent-hover">
          No authenticator set up yet?
        </Button>
        <Button variant="link" type="button" onClick={onBack} className="h-auto min-h-11 p-0 text-[13px] font-normal whitespace-normal text-rx-accent hover:text-rx-accent-hover">
          Back
        </Button>
      </div>
    </form>
  );
}
