"use client";

import { useRouter } from "next/navigation";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { SessionApi } from "@/lib/session/session-api";
import { AdminDetailScreen } from "./admin-detail-screen";

type AdminDetailRouteProps = {
  /** The id in the route: an admin's, or a pending invitation's. */
  readonly adminId: string;
  /** Replaced in tests only. */
  readonly api?: AdminsApi;
  readonly sessionApi?: SessionApi;
};

/**
 * Puts the admin page in its route (RNX-377): after a Resend the page replaces its URL with the new invitation's, so
 * Back does not return to the revoked id. The screen is keyed by the id, which is what Next.js does to the page of a
 * dynamic segment anyway: another id is another screen, with its own load.
 */
export function AdminDetailRoute({ adminId, api, sessionApi }: AdminDetailRouteProps) {
  const router = useRouter();
  return (
    <AdminDetailScreen key={adminId} adminId={adminId} api={api} sessionApi={sessionApi} onInvitationResent={(id) => router.replace(`/admins-and-roles/${encodeURIComponent(id)}`)} />
  );
}
