"use client";

import { useState } from "react";
import { defaultAdminsApi } from "@/lib/admins/default-admins-api";
import type { ReauthCredentials } from "@/lib/admins/reauth-credentials";
import { useReauthGate } from "@/lib/admins/use-reauth-gate";
import type { CreditAdjustmentEntry } from "@/lib/credits/credit-adjustment-entry";
import type { CreditAdjustmentInput } from "@/lib/credits/credit-adjustment-input";
import type { CreditsApi } from "@/lib/credits/credits-api";
import { defaultCreditsApi } from "@/lib/credits/default-credits-api";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { useAdminProfile } from "@/lib/session/use-admin-profile";
import { ReauthPrompt } from "../admins/reauth-prompt";
import { CreditAdjustmentForm } from "./credit-adjustment-form";
import { CreditAdjustmentResult } from "./credit-adjustment-result";

type CreditAdjustmentPanelProps = {
  /** Replaced in tests only. */
  readonly api?: CreditsApi;
  readonly sessionApi?: SessionApi;
  readonly reauth?: (credentials: ReauthCredentials) => Promise<void>;
};

/**
 * Credit adjustment (RNX-99, PRD 09 F6): add or remove credits on a user's or a company's wallet, shown only to an
 * admin with `credits:adjust` (visibility only: the API enforces the permission, the re-authentication and the
 * audit). Asks for re-authentication when the API requires it, then shows the ledger entry and the balance the API
 * answered; a refusal shows a readable message and nothing changes.
 */
export function CreditAdjustmentPanel({ api = defaultCreditsApi, sessionApi = defaultSessionApi, reauth = defaultAdminsApi.reauth }: CreditAdjustmentPanelProps) {
  const profile = useAdminProfile(sessionApi);
  const [entry, setEntry] = useState<CreditAdjustmentEntry | null>(null);
  const { perform, prompt } = useReauthGate(reauth);
  if (!profile?.permissions.includes("credits:adjust")) return null;
  const submit = async (input: CreditAdjustmentInput, idempotencyKey: string): Promise<string | null> => {
    setEntry(null);
    const outcome = await perform(() => api.adjust(input, idempotencyKey));
    if (!outcome.ok) return outcome.message;
    setEntry(outcome.value);
    return null;
  };
  return (
    <section aria-label="Credit adjustment" className="mt-8">
      <h2 className="rx-type-card-heading">Credit adjustment</h2>
      {prompt && <ReauthPrompt prompt={prompt} />}
      <CreditAdjustmentForm onSubmit={submit} />
      {entry && <div className="mt-4 max-w-xl"><CreditAdjustmentResult entry={entry} /></div>}
    </section>
  );
}
