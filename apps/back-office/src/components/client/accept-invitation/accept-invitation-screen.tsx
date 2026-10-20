"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TotpEnrolmentStep } from "@/components/client/sign-in/totp-enrolment-step";
import { defaultInvitationApi } from "@/lib/invitation/default-invitation-api";
import type { InvitationApi } from "@/lib/invitation/invitation-api";
import type { InvitationPreview } from "@/lib/invitation/invitation-preview";
import { takeInvitationToken } from "@/lib/invitation/take-invitation-token";
import { defaultSignInApi } from "@/lib/sign-in/default-sign-in-api";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { SignInApi } from "@/lib/sign-in/sign-in-api";
import { AcceptInvitationForm } from "./accept-invitation-form";

const NO_TOKEN = "This invitation link is not complete. Open the link from your invitation email again.";

type Stage =
  | { readonly kind: "checking" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "form"; readonly token: string; readonly preview: InvitationPreview }
  | { readonly kind: "enrolment" };

type AcceptInvitationScreenProps = {
  /** Replaced in tests only. */
  readonly invitationApi?: InvitationApi;
  /** Replaced in tests only. */
  readonly signInApi?: SignInApi;
};

/**
 * Completing a back-office invitation (RX-95): the token comes from the link's fragment and is kept in
 * memory only (sent in the POST bodies of preview and accept, nowhere else). The preview shows who invited
 * and the role; a used, revoked, expired or unknown link shows the API's message and nothing else. Name and
 * password create the admin on an enrolment session, then the RNX-188 TOTP enrolment and its recovery codes,
 * then the overview.
 */
export function AcceptInvitationScreen({ invitationApi = defaultInvitationApi, signInApi = defaultSignInApi }: AcceptInvitationScreenProps) {
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
      (preview) => isCurrent && setStage({ kind: "form", token: current, preview }),
      (err: unknown) => isCurrent && setStage({ kind: "refused", message: describeFailure(err) }),
    );
    return () => {
      isCurrent = false;
    };
  }, [invitationApi]);
  const accept = async (form: Extract<Stage, { kind: "form" }>, name: string, password: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await invitationApi.accept({ token: form.token, name, password });
      token.current = null;
      setStage({ kind: "enrolment" });
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setIsSubmitting(false);
    }
  };
  if (stage.kind === "enrolment") return <TotpEnrolmentStep api={signInApi} onDone={() => router.replace("/")} />;
  if (stage.kind === "checking") return <p className="mt-4 text-sm text-neutral-600">Checking your invitation…</p>;
  if (stage.kind === "refused") return <p role="alert" className="mt-4 text-sm text-red-700">{stage.message}</p>;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <AcceptInvitationForm preview={stage.preview} isSubmitting={isSubmitting} onSubmit={(name, password) => accept(stage, name, password)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
