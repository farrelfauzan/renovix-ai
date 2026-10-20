import { ForbiddenException } from "@nestjs/common";
import { REAUTH_WINDOW_MINUTES } from "../config/reauth-window";
import type { StaffRequirement } from "../types/staff-requirement";

const MS_PER_MINUTE = 60_000;

/**
 * 403 when the session's scope does not fit the route, or the route declares `reauth: true` and the session's
 * last re-authentication is missing or older than REAUTH_WINDOW_MINUTES at `now` (RX-94, RX-95).
 */
export function assertStaffRequirement(
  session: { readonly scope: string; readonly lastReauthAt: Date | null },
  requirement: StaffRequirement,
  now: Date,
): void {
  const scopeOk = requirement.scope === "any" || session.scope === (requirement.scope ?? "full");
  if (!scopeOk) throw new ForbiddenException();
  const windowMs = REAUTH_WINDOW_MINUTES * MS_PER_MINUTE;
  const reauthOk = !requirement.reauth || (session.lastReauthAt !== null && now.getTime() - session.lastReauthAt.getTime() <= windowMs);
  if (!reauthOk) throw new ForbiddenException("Re-authentication required");
}
