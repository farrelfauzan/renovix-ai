"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { SignInApi } from "@/lib/sign-in/sign-in-api";
import type { TotpEnrolment } from "@/lib/sign-in/totp-enrolment";
import { RecoveryCodes } from "./recovery-codes";
import { TotpConfirmForm } from "./totp-confirm-form";

/**
 * TOTP enrolment on an enrolment session (RX-94): a new secret shown as text and as its otpauth URI (no QR
 * code), the first code confirms it, then the recovery codes once. The secret is dropped once confirmed.
 */
export function TotpEnrolmentStep({ api, onDone }: { api: SignInApi; onDone: () => void }) {
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setIsSubmitting(false);
    }
  };
  const start = () => run(async () => setEnrolment(await api.enrolTotp()));
  const confirm = (code: string) =>
    run(async () => {
      setRecoveryCodes(await api.confirmTotp(code));
      setEnrolment(null);
    });
  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onContinue={onDone} />;
  return (
    <div className="mt-4 flex max-w-xl flex-col gap-4">
      {enrolment ? (
        <>
          <p className="text-sm">Add this account to your authenticator app with the secret or the otpauth URI, then enter the code the app shows.</p>
          <dl className="text-sm">
            <dt className="font-medium">Secret</dt>
            <dd className="font-mono break-all">{enrolment.secret}</dd>
            <dt className="mt-2 font-medium">otpauth URI</dt>
            <dd className="font-mono break-all">{enrolment.otpauthUri}</dd>
          </dl>
          <TotpConfirmForm isSubmitting={isSubmitting} onConfirm={confirm} />
        </>
      ) : (
        <>
          <p className="text-sm">Your account has no authenticator yet. Set one up to finish signing in.</p>
          <Button variant="outline" type="button" disabled={isSubmitting} onClick={start} className="self-start rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
            Set up authenticator
          </Button>
        </>
      )}
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
    </div>
  );
}
