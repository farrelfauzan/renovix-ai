import type { AdminProfile } from "./admin-profile";
import type { GateDecision } from "./gate-decision";

const CHANGE_PASSWORD_PATH = "/change-password";
const SIGN_IN_PATH = "/sign-in";
const OVERVIEW_PATH = "/";

/**
 * Where a gated route goes for the signed-in admin (visibility only: the API's AccessGuard decides). An
 * enrolment session (TOTP not set up yet) reaches nothing and signs in again to enrol; a forced password
 * change reaches only the change-password screen, without the side navigation; a full session reaches every
 * route except the change-password screen.
 */
export function decideGate(profile: AdminProfile, pathname: string): GateDecision {
  if (profile.scope === "enrolment") return { redirectTo: SIGN_IN_PATH };
  const isChangePassword = pathname === CHANGE_PASSWORD_PATH;
  if (profile.scope === "password_change" || profile.mustChangePassword) {
    return isChangePassword ? { showsNavigation: false } : { redirectTo: CHANGE_PASSWORD_PATH };
  }
  return isChangePassword ? { redirectTo: OVERVIEW_PATH } : { showsNavigation: true };
}
