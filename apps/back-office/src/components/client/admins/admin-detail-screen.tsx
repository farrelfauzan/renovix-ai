"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ActionOutcome } from "@/lib/admins/action-outcome";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminRole } from "@/lib/admins/admin-role";
import type { AdminsApi } from "@/lib/admins/admins-api";
import { defaultAdminsApi } from "@/lib/admins/default-admins-api";
import type { IssuedInvitation } from "@/lib/admins/issued-invitation";
import { useReauthGate } from "@/lib/admins/use-reauth-gate";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { AdminDetailPanel } from "./admin-detail-panel";
import { InvitationLinkDialog } from "./invitation-link-dialog";
import { ReauthPrompt } from "./reauth-prompt";

type AdminDetailScreenProps = {
  /** The id in the route: an admin's, or a pending invitation's. */
  readonly adminId: string;
  /** Replaced in tests only. */
  readonly api?: AdminsApi;
  readonly sessionApi?: SessionApi;
};

const LOAD_ERROR = "The admin could not be loaded.";

/**
 * The page of one admin or pending invitation (RNX-373, D443), opened from its row in the admins table. There is no
 * route for one admin, so it reads the admin from the list (`admins:read`). Every write goes through the
 * re-authentication gate, whose prompt and refusals show here, and refetches after the API answers, so the page shows
 * the new state (a revoked invitation is gone from the list: the page says so). Controls follow
 * the signed-in admin's permissions (visibility only: the API enforces them and audits every write).
 */
export function AdminDetailScreen({ adminId, api = defaultAdminsApi, sessionApi = defaultSessionApi }: AdminDetailScreenProps) {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [admins, setAdmins] = useState<readonly AdminListEntry[] | null>(null);
  const [roles, setRoles] = useState<readonly AdminRole[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [hasSeenInvitation, setHasSeenInvitation] = useState(false);
  const { perform, prompt } = useReauthGate(api.reauth);
  const has = (permission: string) => profile?.permissions.includes(permission) ?? false;
  const load = useCallback(
    async (current: AdminProfile) => {
      try {
        const [adminList, roleList] = await Promise.all([
          current.permissions.includes("admins:read") ? api.listAdmins() : [],
          current.permissions.includes("roles:read") ? api.listRoles() : [],
        ]);
        setAdmins(adminList);
        if (adminList.some((candidate) => candidate.id === adminId && candidate.status === "invited")) setHasSeenInvitation(true);
        setRoles(roleList);
        setLoadError(null);
      } catch {
        setLoadError(LOAD_ERROR);
      }
    },
    [api, adminId],
  );
  useEffect(() => {
    sessionApi.me().then((me) => {
      setProfile(me);
      return load(me);
    }, () => setLoadError(LOAD_ERROR));
  }, [sessionApi, load]);
  const run = async <T,>(action: () => Promise<T>): Promise<ActionOutcome<T>> => {
    setActionError(null);
    const outcome = await perform(action);
    if (outcome.ok && profile) await load(profile);
    return outcome;
  };
  const act = async (action: () => Promise<unknown>) => {
    const outcome = await run(action);
    if (!outcome.ok) setActionError(outcome.message);
  };
  const resend = async (id: string, reason: string) => {
    const outcome = await run(() => api.resendInvitation(id, reason));
    if (outcome.ok) setIssued(outcome.value);
    else setActionError(outcome.message);
  };
  if (loadError) return <p role="alert" className="mt-4 text-sm text-rx-red-bar">{loadError}</p>;
  if (!profile || !admins) return <p className="mt-4 text-sm text-rx-muted">Loading…</p>;
  const entry = admins.find((candidate) => candidate.id === adminId);
  return (
    <div className="mt-4 flex flex-col gap-4">
      <Link href="/admins-and-roles" className="inline-flex items-center gap-1.5 self-start text-sm text-rx-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden className="size-4" />
        Admins and roles
      </Link>
      {actionError && <p role="alert" className="text-sm text-rx-red-bar">{actionError}</p>}
      {prompt && <ReauthPrompt prompt={prompt} />}
      {issued && <InvitationLinkDialog issued={issued} onClose={() => setIssued(null)} />}
      {entry && (
        <AdminDetailPanel entry={entry} api={api} roles={roles} isOwnDetail={entry.id === profile.id} canWriteAdmins={has("admins:write")} canWriteRoles={has("roles:write")} onAct={act} onResend={resend} />
      )}
      {!entry && <p className="text-sm text-rx-muted">{hasSeenInvitation ? "This invitation was revoked." : "No admin or invitation has this id."}</p>}
    </div>
  );
}
