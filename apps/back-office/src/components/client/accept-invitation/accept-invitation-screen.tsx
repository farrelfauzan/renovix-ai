"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TotpEnrolmentStep } from "@/components/client/sign-in/totp-enrolment-step";
import { defaultInvitationApi } from "@/lib/invitation/default-invitation-api";
import type { InvitationApi } from "@/lib/invitation/invitation-api";
import type { InvitationPreview } from "@/lib/invitation/invitation-preview";
import { takeInvitationToken } from "@/lib/invitation/take-invitation-token";
import { defaultSignInApi } from "@/lib/sign-in/default-sign-in-api";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { SignInApi } from "@/lib/sign-in/sign-in-api";
import { AcceptInvitationForm } from "./accept-invitation-form";
import { AcceptInvitationHeader } from "./accept-invitation-header";
import { InvitationCard } from "./invitation-card";
import { InvitationInviterCard } from "./invitation-inviter-card";

const NO_TOKEN = "This invitation link is not complete. Open the link from your invitation email again.";

type Stage =
  | { readonly kind: "checking" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "password"; readonly token: string; readonly preview: InvitationPreview }
  | { readonly kind: "authenticator" }
  | { readonly kind: "recovery-codes" };

/** The stepper's index of each stage (Password, Authenticator, Recovery codes, Overview); null shows no stepper. */
const STEP_OF: Record<Stage["kind"], number | null> = { checking: null, refused: null, password: 0, authenticator: 1, "recovery-codes": 2 };

type AcceptInvitationScreenProps = {
  /** The brand mark for the header, rendered by the page (a server component). */
  readonly logo?: ReactNode;
  /** Replaced in tests only. */
  readonly invitationApi?: InvitationApi;
  /** Replaced in tests only. */
  readonly signInApi?: SignInApi;
};

/**
 * Completing a back-office invitation (RX-95), one step at a time as the canvas's Invite artboard draws it (RNX-333):
 * the header's stepper, then the inviter card and the password, the RNX-188 TOTP enrolment, its recovery codes, and
 * the overview. The token comes from the link's fragment and is kept in memory only (sent in the POST bodies of
 * preview and accept, nowhere else). A used, revoked, expired or unknown link shows the API's message and nothing
 * else. The page draws its own header and cards (the session gate leaves this route unframed).
 */
export function AcceptInvitationScreen({ logo, invitationApi = defaultInvitationApi, signInApi = defaultSignInApi }: AcceptInvitationScreenProps) {
  const router = useRouter();
  const token = useRef<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    token.current ??= takeInvitationToken();
    const current = token.current;
    if (!current) {
      setStage({ kind: "refused", message: NO_TOKEN });
      return;
    }
    let isCurrent = true;
    invitationApi.preview(current).then(
      (preview) => isCurrent && setStage({ kind: "password", token: current, preview }),
      (err: unknown) => isCurrent && setStage({ kind: "refused", message: describeFailure(err) }),
    );
    return () => {
      isCurrent = false;
    };
  }, [invitationApi]);
  const accept = async (form: Extract<Stage, { kind: "password" }>, name: string, password: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await invitationApi.accept({ token: form.token, name, password });
      token.current = null;
      setStage({ kind: "authenticator" });
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <>
      <AcceptInvitationHeader logo={logo} step={STEP_OF[stage.kind]} expiresAt={stage.kind === "password" ? stage.preview.expiresAt : null} />
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        {stage.kind === "checking" && <p className="text-sm text-rx-dark-muted">Checking your invitation…</p>}
        {stage.kind === "refused" && (
          <InvitationCard>
            <p role="alert" className="flex items-start gap-2.5 rounded-rx bg-rx-amber-tint px-3 py-2.5 text-[13px] text-rx-amber-text">
              <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-rx-amber-bar" />
              {stage.message}
            </p>
          </InvitationCard>
        )}
        {stage.kind === "password" && (
          <>
            <InvitationInviterCard preview={stage.preview} />
            <AcceptInvitationForm preview={stage.preview} isSubmitting={isSubmitting} error={error} onSubmit={(name, password) => accept(stage, name, password)} />
          </>
        )}
        {(stage.kind === "authenticator" || stage.kind === "recovery-codes") && (
          <InvitationCard>
            <TotpEnrolmentStep api={signInApi} onConfirmed={() => setStage({ kind: "recovery-codes" })} onDone={() => router.replace("/")} />
          </InvitationCard>
        )}
      </div>
    </>
  );
}
