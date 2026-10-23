"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { defaultSignInApi } from "@/lib/sign-in/default-sign-in-api";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { SecondFactor } from "@/lib/sign-in/second-factor";
import type { SignInApi } from "@/lib/sign-in/sign-in-api";
import { SignInCredentialsForm } from "./sign-in-credentials-form";
import { SignInSecondFactorForm } from "./sign-in-second-factor-form";
import { TotpEnrolmentStep } from "./totp-enrolment-step";

type Step = "credentials" | "second-factor" | "enrolment";

/**
 * The back-office sign-in (RX-94, D53): email and password, then the authenticator code or a recovery code,
 * sent together in one request. A refusal shows the API's message only (the API gives one answer to every
 * failure). An enrolment session goes on to the TOTP enrolment; a full one to the overview. `api` is replaced in tests only.
 */
export function SignInScreen({ api = defaultSignInApi }: { api?: SignInApi }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const goToOverview = () => router.replace("/");
  const continueWith = (email: string, password: string) => {
    setCredentials({ email, password });
    setError(null);
    setStep("second-factor");
  };
  const signIn = async (factor: SecondFactor) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const scope = await api.signIn({ ...credentials, ...factor });
      setCredentials({ email: credentials.email, password: "" });
      if (scope === "enrolment") setStep("enrolment");
      else goToOverview();
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setIsSubmitting(false);
    }
  };
  const back = () => {
    setError(null);
    setStep("credentials");
  };
  if (step === "enrolment") return <TotpEnrolmentStep api={api} onDone={goToOverview} />;
  return (
    <div className="mt-4 flex flex-col gap-4">
      {step === "credentials" ? (
        <SignInCredentialsForm email={credentials.email} onContinue={continueWith} />
      ) : (
        <SignInSecondFactorForm isSubmitting={isSubmitting} onSubmit={signIn} onBack={back} />
      )}
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
    </div>
  );
}
