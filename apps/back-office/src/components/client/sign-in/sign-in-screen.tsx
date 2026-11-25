"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { defaultSignInApi } from "@/lib/sign-in/default-sign-in-api";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { SecondFactor } from "@/lib/sign-in/second-factor";
import type { SignInApi } from "@/lib/sign-in/sign-in-api";
import { SignInCredentialsForm } from "./sign-in-credentials-form";
import { SignInNotEnrolled } from "./sign-in-not-enrolled";
import { SignInSecondFactorForm } from "./sign-in-second-factor-form";
import { TotpEnrolmentStep } from "./totp-enrolment-step";

type Step = "credentials" | "second-factor" | "not-enrolled" | "enrolment";

/**
 * The back-office sign-in (RX-94, D53): email and password, then the authenticator code or a recovery code,
 * sent together in one request. A refusal shows the API's message only (the API gives one answer to every
 * failure). An enrolment session goes on to the TOTP enrolment; a full one to the overview. RNX-332: "no
 * authenticator yet" first shows the not-enrolled state; only its "Continue to enrolment" sends the sign-in
 * without a second factor. `api` is replaced in tests only.
 */
export function SignInScreen({ api = defaultSignInApi }: { api?: SignInApi }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const goToOverview = () => router.replace("/");
  const goTo = (next: Step) => {
    setError(null);
    setStep(next);
  };
  const continueWith = (email: string, password: string) => {
    setCredentials({ email, password });
    goTo("second-factor");
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
  if (step === "enrolment") return <TotpEnrolmentStep api={api} onDone={goToOverview} />;
  return (
    <div className="flex flex-col gap-[18px]">
      {error && (
        <p role="alert" className="flex items-start gap-2.5 rounded-rx bg-rx-red-tint px-3 py-2.5 text-[13px] text-rx-red-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-rx-red-bar" />
          {error}
        </p>
      )}
      {step === "credentials" && <SignInCredentialsForm email={credentials.email} onContinue={continueWith} />}
      {step === "second-factor" && <SignInSecondFactorForm isSubmitting={isSubmitting} onSubmit={signIn} onNotEnrolled={() => goTo("not-enrolled")} onBack={() => goTo("credentials")} />}
      {step === "not-enrolled" && <SignInNotEnrolled isSubmitting={isSubmitting} onContinue={() => signIn({})} onBack={() => goTo("second-factor")} />}
    </div>
  );
}
