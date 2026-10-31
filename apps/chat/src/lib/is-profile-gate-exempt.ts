import { PROFILE_STEP_PATH } from "./profile-step-path";

/** The routes the profile gate never redirects from (RNX-33): the profile step itself and the sign-in routes. */
const EXEMPT_PATHS = [PROFILE_STEP_PATH, "/login", "/register"];

/** True for a route the profile gate lets through without a complete profile. */
export function isProfileGateExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
