"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { SignInApi } from "@/lib/sign-in/sign-in-api";
import type { TotpEnrolment } from "@/lib/sign-in/totp-enrolment";
import { RecoveryCodes } from "./recovery-codes";
import { TotpConfirmForm } from "./totp-confirm-form";
import { TotpManualKey } from "./totp-manual-key";
import { TotpQrCode } from "./totp-qr-code";

type TotpEnrolmentStepProps = {
  readonly api: SignInApi;
  /** Finish, after the recovery codes. */
  readonly onDone: () => void;
  /** The first code was accepted and the recovery codes are shown (RNX-333: the invitation's stepper moves on). */
  readonly onConfirmed?: () => void;
};

/**
 * TOTP enrolment on an enrolment session (RX-94), shared by the sign-in and the invitation, styled as the canvas's
 * Invite artboard (RNX-333): a new secret shown as a QR code (RNX-349), as a key in groups of four with Copy and as
 * its otpauth URI, the first code in six boxes confirms it, then the recovery codes once. The secret is dropped once
 * confirmed.
 */
export function TotpEnrolmentStep({ api, onDone, onConfirmed }: TotpEnrolmentStepProps) {
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
      onConfirmed?.();
    });
  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onContinue={onDone} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold tracking-[-0.01em]">Add an authenticator</h2>
        <p className="text-[13px] text-rx-muted">
          {enrolment ? "Required for every staff account. Scan the QR code with your authenticator app, then enter the code it shows." : "Your account has no authenticator yet. Set one up to continue."}
        </p>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2.5 rounded-rx bg-rx-red-tint px-3 py-2.5 text-[13px] text-rx-red-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-rx-red-bar" />
          {error}
        </p>
      )}
      {enrolment ? (
        <>
          <div className="flex justify-center rounded-rx border border-rx-line bg-rx-surface p-4">
            <TotpQrCode otpauthUri={enrolment.otpauthUri} />
          </div>
          <TotpManualKey secret={enrolment.secret} />
          <p className="flex flex-col gap-0.5 text-xs text-rx-muted">
            otpauth URI
            <span className="font-mono break-all">{enrolment.otpauthUri}</span>
          </p>
          <TotpConfirmForm isSubmitting={isSubmitting} onConfirm={confirm} />
        </>
      ) : (
        <Button type="button" disabled={isSubmitting} onClick={start} className="h-11 w-full rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">
          Set up authenticator
        </Button>
      )}
    </div>
  );
}
