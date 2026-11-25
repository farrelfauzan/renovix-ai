"use client";

import type { ReactNode } from "react";
import { defaultPackagesApi } from "@/lib/packages/default-packages-api";
import type { PackagesApi } from "@/lib/packages/packages-api";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { useAdminProfile } from "@/lib/session/use-admin-profile";
import { defaultUsersApi } from "@/lib/users/default-users-api";
import type { UsersApi } from "@/lib/users/users-api";
import { SectionMessage } from "../usage/section-message";
import { UsersDirectory } from "./users-directory";

type UsersScreenProps = {
  /** The page heading, shown in the header row with the search and filters. */
  readonly heading?: ReactNode;
  /** Replaced in tests only. */
  readonly api?: UsersApi;
  readonly packagesApi?: PackagesApi;
  readonly sessionApi?: SessionApi;
};

/**
 * The users screen (RNX-358, PRD 09): the list with exact email or id search and the package and status filters, and
 * the detail with masked personal data and the audited reveal. Shown to admins with `users:read` (visibility only:
 * the API enforces every permission).
 */
export function UsersScreen({ heading, api = defaultUsersApi, packagesApi = defaultPackagesApi, sessionApi = defaultSessionApi }: UsersScreenProps) {
  const profile = useAdminProfile(sessionApi);
  const has = (permission: string): boolean => profile?.permissions.includes(permission) ?? false;
  if (profile && has("users:read")) {
    return <UsersDirectory heading={heading} api={api} packagesApi={packagesApi} canListPackages={has("packages:read")} isMasked={!has("users:read_pii")} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rx-line pb-3">{heading}</header>
      <SectionMessage text={profile ? "Your role has no access to users." : "Loading…"} />
    </div>
  );
}
