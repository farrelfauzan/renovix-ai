"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultAdminsApi } from "@/lib/admins/default-admins-api";
import type { ReauthCredentials } from "@/lib/admins/reauth-credentials";
import { useReauthGate } from "@/lib/admins/use-reauth-gate";
import type { CodeInput } from "@/lib/codes/code-input";
import type { CodeRedemption } from "@/lib/codes/code-redemption";
import type { CodesApi } from "@/lib/codes/codes-api";
import type { CodesPage } from "@/lib/codes/codes-page";
import { defaultCodesApi } from "@/lib/codes/default-codes-api";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { useAdminProfile } from "@/lib/session/use-admin-profile";
import { ReauthPrompt } from "../admins/reauth-prompt";
import { CodeForm } from "./code-form";
import { CodeRow } from "./code-row";

const PAGE_SIZE = 25;

type CodesSectionProps = {
  /** Replaced in tests only. */
  readonly api?: CodesApi;
  readonly sessionApi?: SessionApi;
  readonly reauth?: (credentials: ReauthCredentials) => Promise<void>;
};

/**
 * Invitation codes (RNX-98, D33): list, create, deactivate and see redemptions. Every code route needs
 * `packages:write` (the code text is a redeemable secret), so the section shows only to such admins (visibility
 * only: the API enforces it). Create and deactivate ask for re-authentication; a refusal shows the API's message.
 */
export function CodesSection({ api = defaultCodesApi, sessionApi = defaultSessionApi, reauth = defaultAdminsApi.reauth }: CodesSectionProps) {
  const profile = useAdminProfile(sessionApi);
  const [page, setPage] = useState(1);
  const [codes, setCodes] = useState<CodesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [redemptions, setRedemptions] = useState<{ readonly id: string; readonly list: readonly CodeRedemption[] } | null>(null);
  const { perform, prompt } = useReauthGate(reauth);
  const canWrite = profile?.permissions.includes("packages:write") ?? false;
  const load = useCallback(async () => {
    try {
      setCodes(await api.listCodes(page, PAGE_SIZE));
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, [api, page]);
  useEffect(() => {
    if (canWrite) load();
  }, [canWrite, load]);
  const create = async (input: CodeInput): Promise<string | null> => {
    const outcome = await perform(() => api.createCode(input));
    if (!outcome.ok) return outcome.message;
    await load();
    return null;
  };
  const deactivate = async (id: string) => {
    const outcome = await perform(() => api.deactivateCode(id));
    if (outcome.ok) await load();
    setError(outcome.ok ? null : outcome.message);
  };
  const toggleRedemptions = async (id: string) => {
    if (redemptions?.id === id) return setRedemptions(null);
    try {
      setRedemptions({ id, list: await api.listRedemptions(id) });
    } catch (err) {
      setError(describeFailure(err));
    }
  };
  if (!profile) return <p className="mt-4 text-sm text-rx-muted">Loading…</p>;
  return (
    <section aria-label="Invitation codes" className="mt-8">
      <h2 className="rx-type-card-heading">Invitation codes</h2>
      {!canWrite && <p className="mt-2 text-sm text-rx-muted">Your role cannot see invitation codes (packages:write).</p>}
      {canWrite && !isCreating && <button type="button" onClick={() => setIsCreating(true)} className="mt-2 rounded-rx border border-rx-line px-3 py-1 text-sm">Create code</button>}
      {error && <p role="alert" className="mt-2 text-sm text-rx-red-bar">{error}</p>}
      {prompt && <ReauthPrompt prompt={prompt} />}
      {isCreating && <CodeForm onSave={create} onClose={() => setIsCreating(false)} />}
      {codes && codes.codes.length === 0 && <p className="mt-2 text-sm text-rx-muted">No invitation codes yet.</p>}
      {codes && codes.codes.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="text-rx-muted">
              <tr>
                <th className="pr-3 font-normal">Code</th>
                <th className="pr-3 font-normal">Grants</th>
                <th className="pr-3 font-normal">Redeemed</th>
                <th className="pr-3 font-normal">Expires</th>
                <th className="pr-3 font-normal">Status</th>
                <th className="font-normal"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {codes.codes.map((code) => (
                <CodeRow key={code.id} code={code} redemptions={redemptions?.id === code.id ? redemptions.list : null} onToggleRedemptions={() => toggleRedemptions(code.id)} onDeactivate={() => deactivate(code.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {codes && codes.total > PAGE_SIZE && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-rx border border-rx-line px-3 py-1">Previous</button>
          <span>Page {page} of {Math.ceil(codes.total / PAGE_SIZE)}</span>
          <button type="button" disabled={page * PAGE_SIZE >= codes.total} onClick={() => setPage(page + 1)} className="rounded-rx border border-rx-line px-3 py-1">Next</button>
        </div>
      )}
    </section>
  );
}
