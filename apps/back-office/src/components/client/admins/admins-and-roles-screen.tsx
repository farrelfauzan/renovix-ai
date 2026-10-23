"use client";

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
import { AdminsPanel } from "./admins-panel";
import { InvitationLinkDialog } from "./invitation-link-dialog";
import { ReauthPrompt } from "./reauth-prompt";
import { RolesPanel } from "./roles-panel";

type AdminsAndRolesScreenProps = {
  /** Replaced in tests only. */
  readonly api?: AdminsApi;
  readonly sessionApi?: SessionApi;
};

/**
 * The admins and roles screen (RNX-189, PRD 09 F5): admin list, invitations, role assignment, roles. Controls
 * follow the signed-in admin's permissions (visibility only: the API enforces them and audits every write).
 * Every write goes through the re-authentication gate and refetches the lists after the API answers.
 */
export function AdminsAndRolesScreen({ api = defaultAdminsApi, sessionApi = defaultSessionApi }: AdminsAndRolesScreenProps) {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [admins, setAdmins] = useState<readonly AdminListEntry[] | null>(null);
  const [roles, setRoles] = useState<readonly AdminRole[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const { perform, prompt } = useReauthGate(api.reauth);
  const has = (permission: string) => profile?.permissions.includes(permission) ?? false;
  const load = useCallback(
    async (current: AdminProfile) => {
      try {
        const [adminList, roleList] = await Promise.all([
          current.permissions.includes("admins:read") ? api.listAdmins() : null,
          current.permissions.includes("roles:read") ? api.listRoles() : null,
        ]);
        setAdmins(adminList);
        setRoles(roleList);
        setLoadError(null);
      } catch {
        setLoadError("The admins and roles could not be loaded.");
      }
    },
    [api],
  );
  useEffect(() => {
    sessionApi.me().then((me) => {
      setProfile(me);
      return load(me);
    }, () => setLoadError("The admins and roles could not be loaded."));
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
  const resend = async (id: string) => {
    const outcome = await run(() => api.resendInvitation(id));
    if (outcome.ok) setIssued(outcome.value);
    else setActionError(outcome.message);
  };
  if (loadError) return <p role="alert" className="mt-4 text-sm text-rx-red-bar">{loadError}</p>;
  if (!profile) return <p className="mt-4 text-sm text-rx-muted">Loading…</p>;
  return (
    <div className="mt-4">
      {actionError && <p role="alert" className="text-sm text-rx-red-bar">{actionError}</p>}
      {prompt && <ReauthPrompt prompt={prompt} />}
      {issued && <InvitationLinkDialog issued={issued} onClose={() => setIssued(null)} />}
      {admins && (
        <AdminsPanel admins={admins} roles={roles ?? []} api={api} currentAdminId={profile.id} canWriteAdmins={has("admins:write")} canWriteRoles={has("roles:write")} run={run} onAct={act} onIssued={setIssued} onResend={resend} />
      )}
      {roles && <RolesPanel roles={roles} api={api} canWrite={has("roles:write")} run={run} onAct={act} />}
    </div>
  );
}
