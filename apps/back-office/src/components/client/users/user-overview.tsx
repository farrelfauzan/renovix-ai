"use client";

import type { UserDetail } from "@/lib/users/user-detail";
import { UserStatusPill } from "./user-status-pill";
import { formatDateTime } from "@/lib/users/format-date-time";

/** The account facts of the user detail, as the API answered them. */
export function UserOverview({ detail }: { readonly detail: UserDetail }) {
  return (
    <dl className="m-0 grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] narrow:grid-cols-1">
      <dt className="text-rx-muted">Status</dt>
      <dd className="m-0"><UserStatusPill status={detail.status} /></dd>
      <dt className="text-rx-muted">Package</dt>
      <dd className="m-0">{detail.package?.name ?? "none"}</dd>
      <dt className="text-rx-muted">Available credits</dt>
      <dd className="m-0 font-mono">{detail.creditsAvailable}</dd>
      <dt className="text-rx-muted">Sign-in methods</dt>
      <dd className="m-0">{detail.signInMethods.length ? detail.signInMethods.join(", ") : "none"}</dd>
      <dt className="text-rx-muted">Last sign-in</dt>
      <dd className="m-0">{detail.lastLoginAt ? formatDateTime(detail.lastLoginAt) : "never"}</dd>
    </dl>
  );
}
